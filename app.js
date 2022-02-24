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

        new Homey.FlowCardAction('select_source')
            .register()
            .registerRunListener(this.onFlowActionSelectSource);

        new Homey.FlowCardAction('set_ambihue')
            .register()
            .registerRunListener(this.onFlowActionSetAmbiHue);

        new Homey.FlowCardAction('set_ambilight')
            .register()
            .registerRunListener(this.onFlowActionSetAmbilight);

        new Homey.FlowCardAction('send_key')
            .register()
            .registerRunListener(this.onFlowActionSendKey)
            .getArgument('option')
            .registerAutocompleteListener(this.onFlowKeyAutocomplete.bind(this));

        this.log('Initialized flow');
    }

    async onFlowActionOpenApplication(args) {
        let device = args.device,
            app = args.app;

        return device.openApplication(app);
    }

    async onFlowActionSelectSource(args) {
        let device = args.device,
            source = args.source;

        return device.sendGoogleAssistantSearch(source);
    }

    async onFlowActionSetAmbiHue(args) {
        let device = args.device,
            state = (args.state === 'on');

        return device.setAmbiHue(state);
    }

    async onFlowActionSetAmbilight(args) {
        let device = args.device,
            state = (args.state === 'on');

        return device.setAmbilight(state);
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
                "name": this.getI18nString(key.friendlyName)
            }
        }).filter(result => {
            return result.name.toLowerCase().indexOf(query.toLowerCase()) > -1;
        });

        return Promise.resolve(results);
    }

	getI18nString(i18n) {
		const lang = Homey.ManagerI18n.getLanguage();
		if (i18n[lang])
			return i18n[lang];
		else if (i18n['en'])
			return i18n['en'];
		else
			return `Untranslated string: ${i18n}`;
	}
}

module.exports = PhilipsTV;