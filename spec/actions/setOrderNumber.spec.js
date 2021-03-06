describe('Set Order Number', function () {
    var nock = require('nock');
    var root = 'https://api.sphere.io';
    var masterProduct = require('../data/order_master.json.js');
    var setOrderNumber = require('../../lib/actions/setOrderNumber.js');
    var cfg;
    var self;
    var msg;

    beforeEach(function() {
        nock('https://auth.sphere.io').post('/oauth/token')
            .reply(200, {
                access_token: '70kNDuiU_UstkLgWro3UYlhLbpXO5ywU',
                token_type: 'Bearer',
                expires_in: 172800,
                scope: 'manage_project:elasticio'
            });
        self = jasmine.createSpyObj('self', ['emit']);
        msg = {
            body: {
                orderId: '8fd9f83c-3453-418c-9f3b-5a218bfc842a',
                orderNumber: 'testID'
            }
        };
        cfg = {
            client: 'test_client',
            clientSecret: 'so_secret',
            project: 'test_project'
        };
    });

    describe('Successful Set Order Number', function () {
        it('should emit two calls, proper data message and end message', function () {
            nock(root)
                .get('/test_project/orders/8fd9f83c-3453-418c-9f3b-5a218bfc842a')
                .reply(200, masterProduct.results[0])
                .post('/test_project/orders/8fd9f83c-3453-418c-9f3b-5a218bfc842a')
                .reply(200, {
                    version: 13
                });

            runs(function () {
                setOrderNumber.process.call(self, msg, cfg);
            });

            waitsFor(function() {
                return self.emit.calls.length === 2;
            });

            runs(function () {
                var event = self.emit.calls[0].args[0];
                var data = self.emit.calls[0].args[1].body;
                expect(event).toEqual('data');
                expect(data.version).toEqual(13);
                expect(self.emit.calls[1].args[0]).toEqual('end');
            });
        });
    });

    describe('general error', function () {
        it('should emit two calls, error message and end message', function () {
            nock(root)
                .get('/test_project/orders/8fd9f83c-3453-418c-9f3b-5a218bfc842a')
                .reply(200, masterProduct.results[0])
                .post('/test_project/orders/8fd9f83c-3453-418c-9f3b-5a218bfc842a')
                .reply(400, {message: 'Hey, lucky!', statusCode: 400});

            runs(function () {
                setOrderNumber.process.call(self, msg, cfg);
            });

            waitsFor(function() {
                return self.emit.calls.length === 2;
            });

            runs(function () {
                expect(self.emit.calls[0].args[0]).toEqual('error');
                expect(self.emit.calls[1].args[0]).toEqual('end');
            });
        });
    });
});
