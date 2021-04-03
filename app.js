'use strict';

if (process.env.DEBUG === '1') {
    //require("inspector").open(9229, "0.0.0.0", false);
    require('inspector').open(9229, "0.0.0.0");
}

const Homey = require('homey');

class PhilipsTV extends Homey.App {

    onInit() {
        this.log('Philips TV app is running...');

        this.onInitFlow();
    }

    onInitFlow() {
        new Homey.FlowCardAction('open_application')
            .register()
            .registerRunListener(this.onFlowActionOpenApplication)
            .getArgument('app')
            .registerAutocompleteListener(this.onFlowApplicationAutocomplete);

        new Homey.FlowCardAction('send_key')
            .register()
            .registerRunListener(this.onFlowActionSendKey)
            .getArgument('option')
            .registerAutocompleteListener(this.onFlowKeyAutocomplete);

        this.log('Initialized flow');
    }

    async onFlowActionOpenApplication(args) {
        let device = args.device,
            app = args.app;

        return device.openApplication(app);
    }

    async onFlowApplicationAutocomplete(query, args) {
        let device = args.device;

        return device.getApplications().then(applications => {
            return applications.filter(result => {
                return result.name.toLowerCase().indexOf(query.toLowerCase()) > -1;
            });
        });
    }

    async onFlowActionSendKey(args) {
        let device = args.device,
            option = args.option,
            client = device.getJointspaceClient();

        return client.sendKey(option.key);
    }

    async onFlowKeyAutocomplete(query, args) {
        let device = args.device,
            client = device.getJointspaceClient();

        let results = client.getPossibleKeys().map(key => {
            return {
                "id": key.inputname,
                "key": key.inputname,
                "name": key.friendlyName
            }
        }).filter(result => {
            return result.name.toLowerCase().indexOf(query.toLowerCase()) > -1;
        });

        return Promise.resolve(results);
    }

}

module.exports = PhilipsTV;