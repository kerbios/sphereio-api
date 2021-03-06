var helper = require('../helpers.js');
var messages = require('../messages.js');
var fs = require('fs');
var sphere = require('../sphere.js');
var _ = require('underscore');
var util = require('util');

exports.getMetaModel = getMetaModel;
exports.process = processTrigger;

function getMetaModel(cfg, callback) {
    var client = sphere.createServiceClient('project', cfg);
    var languages;

    client.fetch().then(readSchema).catch(callback);

    function readSchema(data) {
        languages = data.body.languages;
        fs.readFile(__dirname + '/../schemas/queryOrders.out.json', constructMetaData);
    }

    function constructMetaData(err, schema) {
        if (err) {
            return callback(err);
        }
        schema = JSON.parse(schema.toString());
        if (!cfg.expandCustomerExternalId) {
            delete schema.properties.results.properties.customer;
        }
        schema = helper.convertLStrings(schema, languages);
        callback(null, {out: schema});
    }
}

function processTrigger(msg, cfg, next, snapshot) {
    var self = this;

    var client = sphere.createClient(cfg);

    var lastModifiedAt = snapshot.lastModifiedAt || '1970-01-01T00:00:00.000Z';

    var where = 'lastModifiedAt > "' + lastModifiedAt + '"';

    if (cfg.where) {
        where += ' and ' + cfg.where;
    }

    // returns ordersResponse
    function queryOrders() {
        return client.orders
            .where(where)
            .perPage(20)
            .sort('lastModifiedAt', true)
            .fetch();
    }

    // updates ordersResponse.body.results with 'customer' property
    function addCustomersData(ordersResponse){
        if (!cfg.expandCustomerExternalId) return ordersResponse;

        var orders = ordersResponse.body.results;
        if (!orders) return ordersResponse;

        var customerIds = _.compact(_.pluck(orders, 'customerId'));
        if (!customerIds.length) return ordersResponse;

        // bind ordersResponse parameter
        var processCustomers = addCustomersToOrders.bind(null, ordersResponse);

        return client.customers
            .where('id in ("' + customerIds.join('","') + '")')
            .fetch()
            .then(processCustomers);
    }

    function addCustomersToOrders(ordersResponse, customersResponse) {
        var customersHash = {};

        _.each(customersResponse.body.results, function(customer) {
            customersHash[customer.id] = customer;
        });

        _.each(ordersResponse.body.results, function(order) {
            order.customer = customersHash[order.customerId];
        });

        return ordersResponse;
    }

    function addShippingPrices(ordersResponse) {

        _.each(ordersResponse.body.results, function preProcessOrder(order){
            order.shippingPrice = getShippingPrice(order);
        });

        return ordersResponse;

        function getShippingPrice(order){
            if (!order.shippingInfo || !order.shippingInfo.price) return;

            var price = _.clone(order.shippingInfo.price);
            checkFreeShipping(price, order.shippingInfo.shippingRate);
            addTaxRate(price, order.shippingInfo.taxRate);
            return price;
        }

        function checkFreeShipping(price, shippingRate){
            if (!shippingRate || !shippingRate.freeAbove) return;
            checkSameCurrency(price.currencyCode, shippingRate.freeAbove.currencyCode);
            if (price.centAmount > shippingRate.freeAbove.centAmount) {
                price.centAmount = 0;
            }
        }

        function addTaxRate(price, taxRate){
            if (!taxRate || !taxRate.amount || taxRate.includedInPrice) return;
            price.centAmount += Math.round(price.centAmount * taxRate.amount);
        }

        function checkSameCurrency(currencyCode1, currencyCode2){
            if (currencyCode1 !== currencyCode2) {
                throw new Error(util.format('Cannot add %s to %s', currencyCode1, currencyCode2));
            }
        }
    }

    // emits data and snapshot
    function handleResults(ordersResponse) {
        if (ordersResponse.body.count) {
            self.emit('data', messages.newMessageWithBody(ordersResponse.body));
            helper.updateSnapshotWithLastModified(ordersResponse.body.results, snapshot);
        }
        self.emit('snapshot', snapshot);
    }

    function handleError(err) {
        self.emit('error', err);
    }

    queryOrders()
        .then(addCustomersData)
        .then(addShippingPrices)
        .then(helper.centAmountsToAmounts)
        .then(handleResults)
        .catch(handleError)
        .done(function(){
            self.emit('end');
        });
}
