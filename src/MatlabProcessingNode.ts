import { DataFrame, DataSerializer, ProcessingNode, ProcessingNodeOptions, PushOptions } from '@openhps/core';
import { ChildProcess, execFile, spawn } from 'child_process';
import * as shell from 'shelljs';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as net from 'net';
import { v4 as uuidv4 } from 'uuid';

/**
 * Custom data serializer for Matlab Map's
 */
DataSerializer.registerType(Map, {
    serializer: (data, _) => {
        if (data === undefined) {
            return undefined;
        }
        const entries = Array.from(data.entries());
        return entries.map((entry) => ({ key: entry[0], value: DataSerializer.serialize(entry[1]) }));
    },
    deserializer: (data, _) => {
        if (data === undefined) {
            return undefined;
        }
        const result = new Map();
        if (data instanceof Array) {
            data.forEach((entry) => {
                result.set(entry.key, DataSerializer.deserialize(entry.value));
            });
        } else if (data['key'] !== undefined && data['value'] !== undefined) {
            result.set(data.key, DataSerializer.deserialize(data.value));
        }
        return result;
    },
});

/**
 * Matlab script processing node
 */
export class MatlabProcessingNode<In extends DataFrame, Out extends DataFrame> extends ProcessingNode<In, Out> {
    protected options: MatlabNodeOptions;
    protected file: string;
    protected source: string;
    private _server: net.Server;
    private _client: net.Socket;
    private _process: ChildProcess;
    private _promises: Map<string, { resolve: (data?: any) => void; reject: (ex?: any) => void }> = new Map();
    private _socketBuffer = '';
    private _tempDir: string;

    /**
     * Create a matlab processing node for a file
     * @param {string} file Matlab file
     * @param {MatlabNodeOptions} options Matlab node options
     */
    constructor(file?: `${string}.m`, options?: MatlabNodeOptions);
    /**
     * Create a matlab processing node for content
     * @param {string} content Matlab content
     * @param {MatlabNodeOptions} options Matlab node options
     */
    constructor(content?: string, options?: MatlabNodeOptions);
    constructor(fileOrContent?: string, options?: MatlabNodeOptions) {
        super(options);
        this.options.executionPath = this.options.executionPath ?? 'matlab';
        this.options.host = this.options.host ?? '127.0.0.1';
        this.options.port = this.options.port ?? 1337;
        this.options.keepAlive = this.options.keepAlive === undefined ? true : this.options.keepAlive;

        // Freeze the options to avoid other nodes from modifying them
        Object.freeze(this.options);
        if (fileOrContent && fileOrContent.endsWith('.m')) {
            this.file = path.resolve(fileOrContent);
        } else if (fileOrContent) {
            // Create a temp file with a function
            this.source = `
            function frame = process(frame)
            ${fileOrContent}
            end
            `;
        } else {
            throw new Error('Either a Matlab .m file or Matlab content must be provided!');
        }

        if (this.options.keepAlive) {
            this.source = `
            t = tcpclient("${this.options.host}", ${this.options.port});
            configureTerminator(t, "LF", "CR/LF");
            running = true;
            while true
                while t.NumBytesAvailable > 0
                    msg = readline(t);
                    json = jsondecode(msg);
                    if strcmp(json.action, 'process')
                        json.data = process(json.data);
                        t.writeline(jsonencode(json));
                    elseif strcmp(json.action, 'quit')
                        running = false;
                        break;
                    end
                end
                if running == false
                    break;
                end
            end
            function log(msg)
                t.writeline(msg);
            end
            ${this.source}`;
        }

        this.once('build', this._onBuild.bind(this));
        this.once('destroy', this._onDestroy.bind(this));
    }

    private _onBuild(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!shell.which(this.options.executionPath)) {
                return reject(new Error(`MATLAB executable not found!`));
            }
            this.getVersion()
                .then((version) => {
                    if (Number(version) < 9.06) {
                        return reject(new Error('You must have installed MATLAB 2019a or later'));
                    }
                    if (this.source) {
                        return this.createTempFile(this.source, this.options.keepAlive ? 'client.m' : 'process.m');
                    } else {
                        return Promise.resolve(undefined);
                    }
                })
                .then(() => {
                    if (this.options.keepAlive) {
                        // A failed Matlab start must not hang the build forever
                        const connectionTimeout = setTimeout(() => {
                            reject(new Error('The Matlab client did not connect!'));
                        }, 60000);
                        this._server = net.createServer((socket) => {
                            clearTimeout(connectionTimeout);
                            this._client = socket;
                            socket.on('close', () => {
                                this._client = undefined;
                            });
                            socket.on('data', this._onClientMessage.bind(this));
                            socket.on('error', (err) => this.logger('error', `Error on Matlab client socket`, err));
                            resolve();
                        });
                        this._server.once('error', reject);
                        this._server.listen(this.options.port, this.options.host);
                        return this._clientExecute();
                    } else {
                        resolve();
                    }
                })
                .catch(reject);
        });
    }

    private _onDestroy(): Promise<void> {
        return new Promise((resolve) => {
            if (this._server) {
                if (this._client) {
                    this._client.write(
                        JSON.stringify({
                            id: uuidv4(),
                            action: 'quit',
                        }) + '\n',
                    );
                }
                this._server.close();
            }
            if (this._process && !this._process.killed) {
                this._process.on('close', () => resolve());
                if (this._process.pid) {
                    try {
                        process.kill(-this._process.pid);
                    } catch {
                        // The process already exited
                        resolve();
                    }
                } else {
                    resolve();
                }
                this._process = void 0;
            } else {
                resolve();
            }
            if (this._tempDir) {
                fs.rm(this._tempDir, { recursive: true, force: true }, () => {});
                this._tempDir = undefined;
            }
        });
    }

    protected createTempFile(content: string, file = 'process.m'): Promise<string> {
        return new Promise((resolve, reject) => {
            fs.mkdtemp(path.join(os.tmpdir(), 'openhps-matlab'), (err, dir) => {
                if (err) {
                    return reject(err);
                }
                this._tempDir = dir;
                this.file = path.join(dir, file);
                fs.writeFile(this.file, content, (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(this.file);
                });
            });
        });
    }

    protected getVersion(): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile(this.options.executionPath, ['-help'], (err, stdout) => {
                if (err) {
                    return reject(err);
                }
                const lines = stdout.trim().split(/\r?\n/);
                const match = (lines[lines.length - 1] || '').trim().match(/Version:(.*),/);
                if (!match) {
                    return reject(new Error(`Unable to parse the Matlab version!`));
                }
                const versionString = match[1].trim().split('.');
                versionString.length -= 1;
                if (versionString[0].length === 1) {
                    versionString[0] = '0' + versionString[0];
                }
                if (versionString[1].length === 1) {
                    versionString[1] = '0' + versionString[1];
                }
                resolve(parseFloat(versionString.join('.')).toFixed(2));
            });
        });
    }

    process(data: In, options?: PushOptions): Promise<Out> {
        return new Promise((resolve, reject) => {
            // Serialize data for sending to Matlab
            const serializedData = DataSerializer.serialize(data);

            if (!this.options.keepAlive) {
                this._legacyExecute(serializedData).then(resolve).catch(reject);
            } else {
                const id = uuidv4();
                if (!this._client) {
                    return reject(`No Matlab processing client connected!`);
                }

                this._client.write(
                    JSON.stringify({
                        id,
                        action: 'process',
                        data: serializedData,
                        options,
                    }) + '\n',
                );
                this._promises.set(id, { resolve, reject });
            }
        });
    }

    private _onClientMessage(buffer: Buffer): void {
        this._socketBuffer += buffer.toString();
        const lines = this._socketBuffer.split('\n');
        // The last element is the last (possibly incomplete) line
        this._socketBuffer = lines.pop();
        for (const line of lines) {
            if (!line.trim()) {
                continue;
            }
            let msg: any;
            try {
                msg = JSON.parse(line.replace(/x__type/g, '__type'));
            } catch {
                // The line is not a JSON message (e.g. a log line written by the Matlab script)
                continue;
            }
            const promise = this._promises.get(msg.id);
            if (promise) {
                this._promises.delete(msg.id);
                promise.resolve(DataSerializer.deserialize(msg.data));
            }
        }
    }

    private _clientExecute(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Escape the path for the Matlab single-quoted string inside the double-quoted -r argument
            const quotedFile = this.file.replace(/'/g, "''").replace(/"/g, '""');
            this._process = spawn(
                this.options.executionPath,
                ['-automation', '-nosplash', '-nodesktop', '-r', `"run('${quotedFile}'); exit;"`],
                { detached: true },
            );
            this._process.on('error', reject);
            this._process.stderr.setEncoding('utf8');
            // Matlab routinely writes warnings to stderr, so log them and only
            // reject on a failed exit
            this._process.stderr.on('data', (chunk: string) => {
                this.logger('warn', `Matlab stderr: ${chunk.trim()}`);
            });
            this._process.stdout.setEncoding('utf8');
            this._process.stdout.on('data', () => {
                resolve();
            });
            this._process.on('exit', (code) => {
                if (code !== 0) {
                    reject(new Error(`Matlab exited with code ${code}`));
                }
            });
        });
    }

    private _legacyExecute(serializedData: any): Promise<Out> {
        return new Promise((resolve, reject) => {
            const directory = path.dirname(this.file);
            const processFunction = this.file
                .substring(0, this.file.lastIndexOf('.'))
                .replace(directory, '')
                .substring(1);
            // Pass the payload via a temp file to keep it out of the command line
            const inputPath = path.join(os.tmpdir(), `openhps-matlab-${uuidv4()}.json`);
            fs.writeFile(inputPath, JSON.stringify(serializedData), (writeError) => {
                if (writeError) {
                    return reject(writeError);
                }
                // Escape the paths for the Matlab single-quoted strings
                const quotedDirectory = `'${directory.replace(/'/g, "''").replace(/"/g, '""')}'`;
                const quotedInputPath = `'${inputPath.replace(/'/g, "''").replace(/"/g, '""')}'`;
                const cmd =
                    `cd(${quotedDirectory});` +
                    `disp(jsonencode(${processFunction}(jsondecode(fileread(${quotedInputPath})))));` +
                    `exit;`;
                execFile(this.options.executionPath, ['-nosplash', '-batch', cmd], (error, stdout, stderr) => {
                    try {
                        fs.rmSync(inputPath, { force: true });
                    } catch {
                        // Temp file cleanup is best effort
                    }
                    if (error) {
                        return reject(stderr.trim());
                    }
                    const result = stdout
                        .replace(/\\n/g, '\n')
                        .replace(/x__type/g, '__type')
                        .trim();
                    resolve(DataSerializer.deserialize(JSON.parse(result)));
                });
            });
        });
    }
}

export interface MatlabNodeOptions extends ProcessingNodeOptions {
    /**
     * Execution path of the matlab executable
     * @default "matlab"
     */
    executionPath?: string;
    /**
     * Keep the matlab software running by creating a socket connection
     * @default true
     */
    keepAlive?: boolean;
    /**
     * Host to use for the matlab socket server. This socket server is not secured
     * and should only be accessible by the matlab script stream processing your data.
     * @default 127.0.0.1
     */
    host?: string;
    /**
     * Port to use for the matlab socket server.
     * @default 1337
     */
    port?: number;
}
