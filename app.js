'use strict'

const Homey = require('homey')

class PhilipsTV extends Homey.App {

  async onInit () {
    this.log('Philips TV app is running...')

    this.onInitFlow()
  }

  onInitFlow () {
    this.homey.flow.getActionCard('open_application')
      .registerRunListener(this.onFlowActionOpenApplication)
      .registerArgumentAutocompleteListener('app', this.onFlowApplicationAutocomplete)

    this.homey.flow.getActionCard('open_google_assistant')
      .registerRunListener(this.onFlowActionOpenGoogleAssistant);

      // this.homey.flow.getActionCard('application_opened')
      //       .register()
      //       .getArgument('app')
      //       .registerAutocompleteListener(this.onFlowApplicationAutocomplete);

    this.homey.flow.getActionCard('select_source')
      .registerRunListener(this.onFlowActionSelectSource)

    this.homey.flow.getActionCard('send_key')
      .registerRunListener(this.onFlowActionSendKey)
      .registerArgumentAutocompleteListener('option', this.onFlowKeyAutocomplete.bind(this))

    this.homey.flow.getActionCard('set_ambihue')
      .registerRunListener(this.onFlowActionSetAmbiHue)

    this.homey.flow.getActionCard('set_ambilight')
      .registerRunListener(this.onFlowActionSetAmbilight)

    this.homey.flow.getActionCard('set_ambilight_mode')
      .registerRunListener(this.onFlowActionSetAmbilightMode)

    this.log('Initialized flow')
  }

  async onFlowActionOpenApplication ({ device, app }) {
    return device.openApplication(app)
  }

  async onFlowActionSelectSource (args) {
    let device = args.device,
      source = args.source

    return device.sendGoogleAssistantSearch(source)
  }

  async onFlowActionSetAmbiHue ({ device, state }) {
    return device.setAmbiHue(state === 'on')
  }

  async onFlowActionSetAmbilight ({ device, state }) {
    return device.setAmbilight(state === 'on')
  }

  async onFlowActionOpenGoogleAssistant ({ device, input }) {
    return device.sendGoogleAssistantSearch(input)
  }

  async onFlowActionSetAmbilightMode ({ device, mode }) {
    return device.setAmbilightMode(mode)
  }

  async onFlowApplicationAutocomplete (query, { device }) {
    return device.getApplications().then(applications => {
      return applications.filter(result => {
        return result.name.toLowerCase().indexOf(query.toLowerCase()) > -1
      })
    })
  }

  async onFlowActionSendKey (args) {
    let device = args.device,
      option = args.option,
      client = device.getJointspaceClient()

    return client.sendKey(option.key)
  }

  async onFlowKeyAutocomplete (query, args) {
    let device = args.device,
      client = device.getJointspaceClient()

    let results = client.getPossibleKeys().map(key => {
      return {
        'id': key.inputName,
        'key': key.inputName,
        'name': this.getI18nString(key.friendlyName)
      }
    }).filter(result => {
      return result.name.toLowerCase().indexOf(query.toLowerCase()) > -1
    })

    return Promise.resolve(results)
  }

  getI18nString (i18n) {
    const lang = 'en' //Homey.ManagerI18n.getLanguage()
    if (i18n[lang])
      return i18n[lang]
    else if (i18n['en'])
      return i18n['en']
    else
      return `Untranslated string: ${i18n}`
  }
}

module.exports = PhilipsTV
