import { CallbackSinkNode, DataFrame, DataObject, Model, ModelBuilder } from '@openhps/core';
import 'mocha';
import { MatlabProcessingNode } from '../../src/MatlabProcessingNode';

describe('MatlabProcessingNode', () => {
    let model: Model;
    let sink: CallbackSinkNode<any> = new CallbackSinkNode();

    before((done) => {
        ModelBuilder.create()
            .from()
            .via(new MatlabProcessingNode(""))
            .to(sink)
            .build().then(m => {
                model = m;
                done();
            }).catch(done);
    });

    it('should process data', (done) => {
        sink.callback = (frame) => {
            console.log(frame);
            done();
        };
        model.once('error', done);
        const frame = new DataFrame(new DataObject("abc", "123"));
        frame.addObject(new DataObject("test"));
        model.push(frame);
    });

});