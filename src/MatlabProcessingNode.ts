import { DataFrame, DataSerializer, ProcessingNode, ProcessingNodeOptions } from '@openhps/core';
import { exec, spawn } from 'child_process';
import * as shell from 'shelljs';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 *
 * @see {@link https://github.com/zeybek/node-matlab}
 */
export class MatlabProcessingNode<In extends DataFrame, Out extends DataFrame> extends ProcessingNode<In, Out> {
    protected options: MatlabNodeOptions;
    protected file: string;
    protected source: string;

    constructor(file?: string, options?: MatlabNodeOptions);
    constructor(content?: string, options?: MatlabNodeOptions);
    constructor(fileOrContent?: string, options?: MatlabNodeOptions) {
        super(options);
        this.options.executionPath = this.options.executionPath ?? 'matlab';
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
        this.once('build', this._onBuild.bind(this));
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
                        return this.createTempFile(this.source);
                    } else {
                        return Promise.resolve(undefined);
                    }
                })
                .then(() => {
                    resolve();
                })
                .catch(reject);
        });
    }

    protected createTempFile(content: string): Promise<string> {
        return new Promise((resolve, reject) => {
            fs.mkdtemp(path.join(os.tmpdir(), 'openhps-matlab'), (err, dir) => {
                if (err) {
                    return reject(err);
                }
                this.file = path.join(dir, 'process.m');
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
            exec(`${this.options.executionPath} -help`, (error, stdout, stderr) => {
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

    process(data: In): Promise<Out> {
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
                const result = stdout.replace(/\\n/g, '\n').trim();
                console.log(JSON.parse(result));
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
     * Keep the MATLAB script alive after processing. This is recommended
     * as multiple frames need to be processed in a positioning system.
     */
    keepAlive?: boolean;
}
