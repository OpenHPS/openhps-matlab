import { DataFrame, DataSerializer, ProcessingNode, ProcessingNodeOptions, PushOptions } from '@openhps/core';
import { exec } from 'child_process';
import * as shell from 'shelljs';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as net from 'net';
import { v4 as uuidv4 } from 'uuid';

/**
 * Matlab script processing node
 */
export class MatlabProcessingNode<In extends DataFrame, Out extends DataFrame> extends ProcessingNode<In, Out> {
    protected options: MatlabNodeOptions;
    protected file: string;
    protected source: string;
    private _server: net.Server;
    private _client: net.Socket;
    private _promises: Map<string, { resolve: (data?: any) => void; reject: (ex?: any) => void }> = new Map();
    
    constructor(file?: string, options?: MatlabNodeOptions);
    constructor(content?: string, options?: MatlabNodeOptions);
    constructor(fileOrContent?: string, options?: MatlabNodeOptions) {
        super(options);
        this.options.executionPath = this.options.executionPath ?? 'matlab';
        this.options.host = this.options.host ?? "127.0.0.1";
        this.options.port = this.options.port ?? 1337;
        this.options.keepAlive = this.options.keepAlive === undefined ? true : this.options.keepAlive;

        Object.freeze(this.options.executionPath);
        if (fileOrContent.endsWith('.m')) {
            this.file = path.resolve(fileOrContent);
        } else {
            // Create a temp file with a function
            this.source = `
            function frame = process(frame)
            ${fileOrContent}
            end
            `;
        }

        if (this.options.keepAlive) {
            this.source = `
            t = tcpclient("${this.options.host}", ${this.options.port});
            configureTerminator(t, "LF", "CR/LF");
            while true
                while t.NumBytesAvailable > 0
                    msg = readline(t);
                    json = jsondecode(msg);
                    if json.action == 'process'
                        json.data = process(json.data);
                        t.writeline(jsonencode(json));
                    end
                end
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
                        reject(new Error('You must have installed MATLAB 2019a or later'));
                    }
                    if (this.source) {
                        return this.createTempFile(this.source, this.options.keepAlive ? "client.m" : "process.m");
                    } else {
                        return Promise.resolve(undefined);
                    }
                })
                .then(() => {
                    if (this.options.keepAlive) {
                        this._server = net.createServer((socket) => {
                            this._client = socket;
                            socket.on('close', () => {
                                this._client = undefined;
                            });
                            socket.on('data', this._onClientMessage.bind(this));
                            socket.on("error", (err) => this.logger('error', err));
                            resolve();
                        });
                        
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
                this._server.close();
            }
            resolve();
        });
    }

    protected createTempFile(content: string, file: string = 'process.m'): Promise<string> {
        return new Promise((resolve, reject) => {
            fs.mkdtemp(path.join(os.tmpdir(), 'openhps-matlab'), (err, dir) => {
                if (err) {
                    return reject(err);
                }
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
            exec(`${this.options.executionPath} -help`, (_, stdout) => {
                const versionString = stdout
                    .trim()
                    .split('\r\n')
                    .reverse()[0]
                    .trim()
                    .match(/Version:(.*),/)[1]
                    .trim()
                    .split('.');
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
            if (!this.options.keepAlive) {
                this._legacyExecute(data).then(resolve).catch(reject);
            } else {
                const id = uuidv4();
                if (!this._client) {
                    return reject(`No Matlab processing client connected!`);
                }
    
                this._client.write((JSON.stringify({
                    id,
                    action: "process",
                    data: DataSerializer.serialize(data),
                    options
                }) + "\n"));
                this._promises.set(id, { resolve, reject });
            }
        });
    }

    private _onClientMessage(buffer: Buffer): void {
        const msg = JSON.parse(buffer.toString().replace(/x__type/g, '__type'));
        const promise = this._promises.get(msg.id);
        if (promise) {
            console.log(msg.data);
            promise.resolve(DataSerializer.deserialize(msg.data));
        }
    }

    private _clientExecute(): Promise<void> {
        return new Promise((resolve, reject) => {
            const cmd = `${this.options.executionPath} -nosplash -nodesktop -r ` + 
                `run('${this.file}')"`;
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    return reject(stderr.trim());
                }
                resolve();
            });
        });
    }

    private _legacyExecute(data: In): Promise<Out> {
        return new Promise((resolve, reject) => {
            const directory = path.dirname(this.file);
            const processFunction = this.file
                .substring(0, this.file.lastIndexOf('.'))
                .replace(directory, '')
                .substring(1);
            const input = encodeURI(JSON.stringify(DataSerializer.serialize(data)));
            const cmd = `${this.options.executionPath} -nosplash -batch ` + 
                `"cd('${directory}');` + 
                `disp(jsonencode(${processFunction}(jsondecode(urldecode('${input}')))));` + 
                `exit;"`;
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    return reject(stderr.trim());
                }
                const result = stdout.replace(/\\n/g, '\n').replace(/x__type/g, '__type').trim();
                resolve(DataSerializer.deserialize(JSON.parse(result)));
            });
        });
    }
}

export interface MatlabNodeOptions extends ProcessingNodeOptions {
    /**
     * Execution path of the matlab executable
     *
     * @default matlab
     */
    executionPath?: string;
    /**
     * Keep the matlab software running by creating a socket connection
     *
     * @default true
     */
    keepAlive?: boolean;
    /**
     * Host to use for the matlab socket server. This socket server is not secured
     * and should only be accessible by the matlab script stream processing your data.
     * 
     * @default 127.0.0.1
     */
    host?: string;
    /**
     * Port to use for the matlab socket server.
     *
     * @default 1337
     */
    port?: number;
}
