import { CallbackSinkNode, DataFrame, DataObject, Model, ModelBuilder } from '@openhps/core';
import 'mocha';
import { MatlabProcessingNode } from '../../src/MatlabProcessingNode';

describe('MatlabProcessingNode', () => {
    describe('process', () => {
        let model: Model;
        let sink: CallbackSinkNode<any> = new CallbackSinkNode();
    
        before((done) => {
            ModelBuilder.create()
                .from()
                .via(new MatlabProcessingNode(`
                
                `))
                .to(sink)
                .build().then(m => {
                    model = m;
                    done();
                }).catch(done);
        });
    
        after(() => {
            model.destroy();
        });
    
        it('should forward data with two data objects in a frame', (done) => {
            sink.callback = (frame) => {
                done();
            };
            model.once('error', done);
            const frame = new DataFrame(new DataObject("abc", "123"));
            frame.addObject(new DataObject("test"));
            model.push(frame);
        });
    
        it('should forward data with one data object in a frame', (done) => {
            sink.callback = (frame) => {
                done();
            };
            model.once('error', done);
            const frame = new DataFrame(new DataObject("abc", "123"));
            model.push(frame);
        });
    });

    describe('socket', () => {
        let model: Model;
        let sink: CallbackSinkNode<any> = new CallbackSinkNode();
    
        before((done) => {
            ModelBuilder.create()
                .from()
                .via(new MatlabProcessingNode(`
                
                `, {
                    keepAlive: true
                }))
                .to(sink)
                .build().then(m => {
                    model = m;
                    done();
                }).catch(done);
        });
    
        after(() => {
            model.destroy();
        });
    
        it('should forward data with two data objects in a frame', (done) => {
            sink.callback = (frame) => {
                done();
            };
            model.once('error', done);
            const frame = new DataFrame(new DataObject("abc", "123"));
            frame.addObject(new DataObject("test"));
            model.push(frame);
        });
    
        it('should forward data with one data object in a frame', (done) => {
            sink.callback = (frame) => {
                done();
            };
            model.once('error', done);
            const frame = new DataFrame(new DataObject("abc", "123"));
            model.push(frame);
        });
    });

});
