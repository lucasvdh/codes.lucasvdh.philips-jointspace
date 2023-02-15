'use strict'

const Homey = require('homey')
const { setTimeout } = require('timers/promises')
const JointspaceClient = require('../../lib/JointspaceClient.js')
const wol = require('wol')
const { AmbilightConfigurationEnum } = require('../../lib/Enums')

const CAPABILITIES_SET_DEBOUNCE = 100
const UPDATE_INTERVAL = 5000

const capabilities = {
  'onoff': 'on'
}

const keyCapabilities = [
  'key_stop',
  'key_play',
  'key_pause',
  'key_play_pause',
  'key_online',
  'key_record',
  'key_rewind',
  'key_fast_forward',
  'key_toggle_ambilight',
  'key_source',
  'key_toggle_subtitles',
  'key_teletext',
  'key_viewmode',
  'key_watch_tv',
  'key_confirm',
  'key_previous',
  'key_next',
  'key_adjust',
  'key_cursor_left',
  'key_cursor_up',
  'key_cursor_right',
  'key_cursor_down',
  'key_info',
  'key_digit_1',
  'key_digit_2',
  'key_digit_3',
  'key_digit_4',
  'key_digit_5',
  'key_digit_6',
  'key_digit_7',
  'key_digit_8',
  'key_digit_9',
  'key_digit_0',
  'key_dot',
  'key_options',
  'key_back',
  'key_home',
  'key_find',
  'key_red',
  'key_green',
  'key_yellow',
  'key_blue'
]

class PhilipsTV extends Homey.Device {

  async onInit () {
    this._data = this.getData()
    this._settings = this.getSettings()
    this._applications = null

    this.removeAllListeners('__log')
    this.on('__log', (...props) => {
      this.driver.log.bind(this, `[TV: ${this.getIPAddress()}]`)(...props)
    })

    this.fixCapabilities()
    this.parseStateChanges = this.parseStateChanges.bind(this)

    // Try getting device status for three seconds, otherwise, consider it off
    this.initStateTimeout = setTimeout(this.setCapabilityValue.bind(this, 'onoff', false), 3000)

    this.log('registering listeners')
    this.registerListeners()

    this.setSettingsVolumeSlider()

    this.log('flow card conditions temporarily disabled')
    // this.deviceLog('registering flow card conditions');
    // this.registerFlowCardConditions();

    this.ready().then(() => {
      this.log('Initializing change poller')
      this.pollChanges()
      this.log('Initializing live change notification')
      this.notifyChanges()

      this.log('Initialized')
    })
  }

  onDeleted () {
    clearTimeout(this.pollTimeout)
  }

  fixCapabilities () {
    let newCapabilities = [
      'current_application',
    ]

    for (let i in newCapabilities) {
      let newCapability = newCapabilities[i]

      if (!this.hasCapability(newCapability)) {
        this.addCapability(newCapability)
      }
    }
  }

  registerListeners () {
    this._onCapabilitiesSet = this._onCapabilitiesSet.bind(this)
    // this._getCapabilityValue = this._getCapabilityValue.bind(this);

    this.registerMultipleCapabilityListener(keyCapabilities, (capability, options) => {
      return this._onCapabilitiesKeySet(capability, options)
    }, CAPABILITIES_SET_DEBOUNCE)

    this.registerCapabilityListener('onoff', value => {
      return this._onCapabilityOnOffSet(value)
    })

    this.registerCapabilityListener('ambilight_mode', value => {
      return this._onCapabilityAmbilightModeSet(value)
    })

    this.registerCapabilityListener('ambilight_onoff', value => {
      return this._onCapabilityAmbilightOnOffSet(value)
    })

    this.registerCapabilityListener('ambihue_onoff', value => {
      return this._onCapabilityAmbihueOnOffSet(value)
    })

    this.registerCapabilityListener('speaker_next', () => {
      return this.sendKey('Next')
    })

    this.registerCapabilityListener('speaker_prev', () => {
      return this.sendKey('Previous')
    })

    this.registerCapabilityListener('speaker_playing', value => {
      if (value) {
        this.sendKey('Play')
      } else {
        this.sendKey('Pause')
      }

      // Just resolve, it takes way too long to wait for a response
      return Promise.resolve()
    })

    this.registerCapabilityListener('volume_up', value => {
      return this.sendKey('VolumeUp')
    })
    this.registerCapabilityListener('volume_down', value => {
      return this.sendKey('VolumeDown')
    })
    this.registerCapabilityListener('volume_mute', value => {
      // Get the current volume of the TV and default to half of max volume
      let currentVolume = this.getCapabilityValue('volume_set') || Math.round(this._settings.volumeMax / 2)

      return this.getJointspaceClient().setVolume(currentVolume, value)
    })
    this.registerCapabilityListener('volume_set', value => {
      value = value.toFixed(0)
      if (value > this._settings.volumeMax) {
        value = this._settings.volumeMax
      }
      return this.setVolume(value)
    })

  }

  getMACAddress () {
    return this._data.mac
  }

  getIPAddress () {
    return this._settings.ipAddress
  }

  getAPIVersion () {
    return this._settings.apiVersion
  }

  getSecure () {
    return this._settings.secure !== false
  }

  getPort () {
    return this._settings.port
  }

  getCredentials () {
    return this._data.credentials
  }

  getApplications () {
    return new Promise((resolve, reject) => {
      if (this._applications === null || typeof this._applications === 'undefined') {
        this.getJointspaceClient()
          .getApplications()
          .then(applications => {
            return applications.map(application => {
              return {
                'id': application.id,
                'name': application.label,
                'intent': application.intent
              }
            })
          }).catch(reject).then(applications => {
          this._applications = applications

          resolve(applications)
        })
      } else {
        resolve(this._applications)
      }
    })
  }

  openApplication (application) {
    return this.getJointspaceClient().launchActivity(application.intent).then(() => {
      return this.driver.triggerApplicationOpenedTrigger(this, {
        app: application.name
      }).catch(this.error)
    })
  }

  sendGoogleAssistantSearch (query) {
    let searchIntent = {
      'extras': { 'query': query },
      'action': 'Intent {  act=android.intent.action.ASSIST cmp=com.google.android.katniss/com.google.android.apps.tvsearch.app.launch.trampoline.SearchActivityTrampoline flg=0x10200000 }',
      'component': {
        'packageName': 'com.google.android.katniss',
        'className': 'com.google.android.apps.tvsearch.app.launch.trampoline.SearchActivityTrampoline'
      }
    }

    return this.getJointspaceClient().launchActivity(searchIntent)
  }

  setAmbiHue (state) {
    return this.getJointspaceClient().setAmbiHue(state).then(() => {
      return this.driver.triggerAmbiHueChangedTrigger(this, {
        enabled: state
      }).catch(this.error)
    })
  }

  setAmbilightMode (mode) {
    const configuration = AmbilightConfigurationEnum[mode]

    return this.getJointspaceClient().setAmbilightConfiguration(configuration).then(() => {
      return this.driver.triggerAmbilightModeChangedTrigger(this, {
        mode
      }).catch(this.error)
    }).catch(error => {
      this.log('setAmbilightMode failed', error)
    })
  }

  setAmbilight (state) {
    return this.getJointspaceClient().setAmbilight(state).then(() => {
      return this.driver.triggerAmbilightChangedTrigger(this, {
        enabled: state
      }).catch(this.error)
    }).catch(error => {
      this.log(error)
      return error
    })
  }

  hasCredentials () {
    return this._data.credentials !== null
      && (typeof this._data.credentials.user !== 'undefined')
      && this._data.credentials.user !== null
  }

  handleAudioChange (source, newState) {
    const muted = (newState.muted === true),
      currentVolume = this.getCapabilityValue('volume_set'),
      powerState = this.getCapabilityValue('onoff')

    if (this.getCapabilityValue('volume_mute') !== muted) {
      this.log(`TV ${muted ? 'muted' : 'unmuted'} by ${source}`)

      this.setCapabilityValue('volume_mute', muted)
        .catch(this.error)
    }

    // We only want to update the current volume on our device if the TV is not muted. When muted, the TV
    // returns the current volume as zero. We don't set this zero value because we
    // need to provide the current volume whilst unmuting the TV.
    //
    // When TV switches between TV speakers / Audio system, it also changes volume.
    // This is fine, except when it happens when the TV is also turned off
    if (!muted && powerState && currentVolume != newState.current) {
      this.log(`Volume changed from ${currentVolume} to ${newState.current} by ${source}`)

      this.setCapabilityValue('volume_set', newState.current)
        .catch(this.error)
    }
  }

  handleAmbiHueChange (source, newState) {
    let currentState = this.getCapabilityValue('ambihue_onoff'),
      ambiHueState = (newState.power === 'On')

    if (currentState !== ambiHueState) {
      this.log(`Ambihue state changed to ${ambiHueState} by ${source}`)

      this.driver.triggerAmbiHueChangedTrigger(this, {
        enabled: ambiHueState
      })
      this.setCapabilityValue('ambihue_onoff', ambiHueState)
    }
  }

  handleAmbilightChange (source, newState) {
    let currentAmbilightState = this.getCapabilityValue('ambilight_onoff'),
      currentAmbilightMode = this.getCapabilityValue('ambilight_mode')

    let currentAmbilightConfiguration = AmbilightConfigurationEnum[currentAmbilightMode]

    let ambilightState = (newState.styleName !== 'OFF'),
      newAmbilightMode = this.getAmbilightModeByConfiguration(newState)

    if (currentAmbilightState !== ambilightState) {
      this.log(`Ambilight state changed to ${ambilightState} by ${source}`)

      this.driver.triggerAmbilightChangedTrigger(this, {
        enabled: ambilightState
      })
      this.setCapabilityValue('ambilight_onoff', ambilightState)
    }

    if (JSON.stringify(currentAmbilightConfiguration) !== JSON.stringify(newState) && newAmbilightMode !== null && typeof newAmbilightMode !== 'undefined') {
      this.log(`Ambilight mode changed to ${newAmbilightMode} by ${source}`)

      this.driver.triggerAmbilightModeChangedTrigger(this, { mode: newAmbilightMode })
      this.setCapabilityValue('ambilight_mode', newAmbilightMode)
    }
  }

  /**
   * @param {Object} ambilightConfiguration
   * @returns {string|null}
   */
  getAmbilightModeByConfiguration (ambilightConfiguration) {
    return Object.keys(AmbilightConfigurationEnum)
      .filter((key) => {
        return JSON.stringify(AmbilightConfigurationEnum[key]) === JSON.stringify(ambilightConfiguration)
      })
      .pop()
  }

  handleActivityChange (source, newState) {
    let activeComponent = newState.component

    this.getApplications().then(applications => {
      let currentApplication = applications.filter(
        application =>
          application.intent.component.packageName === activeComponent.packageName
          && application.intent.component.className === activeComponent.className
      ).pop()

      let currentDeviceApplication = this.getCapabilityValue('current_application')

      if (typeof currentApplication !== 'undefined') {
        this.log(`Current application changed from ${currentDeviceApplication} to ${currentApplication.name} by ${source}`)

        this.setCapabilityValue('current_application', currentApplication.name)
          .catch(this.error)

        if (currentDeviceApplication !== currentApplication.name) {
          this.driver.triggerApplicationOpenedTrigger(this, {
            app: currentApplication.name
          })
        }
      } else {
        this.log(`Current application changed from ${currentDeviceApplication} to unknown by ${source}`)

        this.setCapabilityValue('current_application', null)
          .catch(this.error)

        if (currentDeviceApplication !== null) {
          this.driver.triggerApplicationOpenedTrigger(this, {
            app: null
          })
        }
      }
    })
  }

  handlePowerStateChange (source, newState) {
    clearTimeout(this.initStateTimeout)
    newState = newState.powerstate === 'On'

    if (this.getCapabilityValue('onoff') != newState) {
      this.log(`Power state changed to ${newState} by ${source}`)

      this.setCapabilityValue('onoff', newState)
        .catch(this.error)
    }
  }

  parseStateChanges (source, state) {
    const pathMap = {
      'powerstate': this.handlePowerStateChange,
      'audio/volume': this.handleAudioChange,
      'activities/current': this.handleActivityChange,
      'huelamp/power': this.handleAmbiHueChange,
      'ambilight/currentconfiguration': this.handleAmbilightChange
    }

    for (const [path, handler] of Object.entries(pathMap)) {
      if (state[path]) {
        if (source != 'notifyChanges') {
          this.lastState[path] = state[path]
        }

        handler.call(this, source, state[path])
      }
    }
  }

  // Real-time changes
  notifyChanges () {
    this.getJointspaceClient().notifyChange(this.lastState)
      .then((state) => {
        if (state instanceof Error) {
          this.log('Error received in then of notifyChanges', state)
        } else {
          this.lastState = state
          this.parseStateChanges('notifyChanges', state)
        }
      })
      .then(() => {
        this.notifyChanges()
      })
      .catch((error) => {
        switch (error.code) {
          // A timeout is expected behaviour for this request
          case 'ECONNRESET':
            this.notifyChanges()
            break

          default:
            this.log('Error occured running notifyChanges', error)
            setTimeout(this.notifyChanges.bind(this), 60 * 1000)
        }
      })

  }

  pollChanges (pollTimeout = 10000) {
    this.pollTimeout = setTimeout(() => {
      try {
        this.getChanges()
          .catch(error => {
            if (this.getCapabilityValue('onoff')) {
              this.log('Change poller failed with:', error, 'Changing power state to off')
              this.setCapabilityValue('onoff', false)
                .catch(this.error)
            }
          })
          .finally(() => {
            this.pollChanges()
          })
      } catch (error) {
        this.error('Change poller failed completely', error)
        this.pollChanges()
      }
    }, pollTimeout)
  }

  getChanges () {
    let jsc = this.getJointspaceClient()
    return Promise.all([
      jsc.getAudioData().then(async response => {
        // prevent hitting rate limiter
        await setTimeout(1000, 'resolved')

        return response
      }).then(this.handleAudioChange.bind(this, 'poller')),
      jsc.getAmbiHue().then(async response => {
        // prevent hitting rate limiter
        await setTimeout(1000, 'resolved')

        return response
      }).then(this.handleAmbiHueChange.bind(this, 'poller')),
      jsc.getAmbilight().then(async response => {
        // prevent hitting rate limiter
        await setTimeout(1000, 'resolved')

        return response
      }).then(this.handleAmbilightChange.bind(this, 'poller')),
      jsc.getPowerState().then(async response => {
        // prevent hitting rate limiter
        await setTimeout(1000, 'resolved')

        return response
      }).then(this.handlePowerStateChange.bind(this, 'poller'))
    ])
  }

  _onCapabilityOnOffSet (value) {
    this.log(`powering ${value ? 'on' : 'off'} device`)

    // Always try sending a magic packet
    if (value && this.getMACAddress()) {
      wol.wake(this.getMACAddress())

      // Send twice in case the first one got lost in transit
      setTimeout(wol.wake, 1000, this.getMACAddress())
    }

    return this.getJointspaceClient().setPowerState(value).then(() => {
      this.log(`successfully sent power ${value ? 'on' : 'off'}`)
    }).catch(error => {
      this.log('setPowerState failed', error)
    })
  }

  _onCapabilityAmbilightModeSet (value) {
    return this.setAmbilightMode(value)
  }

  _onCapabilityAmbilightOnOffSet (value) {
    return this.setAmbilight(value)
  }

  _onCapabilityAmbihueOnOffSet (value) {
    let setting = {
      'values': [
        {
          'value': {
            'Nodeid': 2131230774,
            'Controllable': 'true',
            'Available': 'true',
            'data': {
              'value': (value ? 'true' : 'false'),
            }
          }
        }
      ]
    }

    return this.getJointspaceClient().setSetting(setting)
  }

  _onCapabilitiesSet (valueObj, optsObj) {
    console.log(valueObj, optsObj)

    return true
  }

  async setSettingsVolumeSlider () {
    // Adjust slider to max volume available on TV. Also set step to 1 not to send decimals
    this.setCapabilityOptions('volume_set', {
      min: 0,
      max: this._settings.volumeMax,
      step: 1.0
    })
  }

  async sendKey (key) {
    return await this.getJointspaceClient().sendKey(key).catch(this.error)
  }

  async setVolume (volume, mute = false) {
    return await this.getJointspaceClient().setVolume(volume, mute).catch(this.error)
  }

  getJointspaceClient () {
    if (typeof this._client === 'undefined' || this._client === null) {
      this._client = new JointspaceClient(this.getCredentials().user)
      this._client.registerLogListener(this.log)

      if (this.hasCredentials()) {
        this._client.setConfig(
          this.getIPAddress(),
          this.getAPIVersion(),
          this.getCredentials().user,
          this.getCredentials().pass,
          this.getSecure(),
          this.getPort()
        )
      } else {
        this._client.setConfig(
          this.getIPAddress(),
          this.getAPIVersion(),
          null,
          null,
          this.getSecure(),
          this.getPort()
        )
      }
    }

    return this._client
  }

  _onCapabilitiesKeySet (capability, options) {
    console.log(capability, options)

    if (typeof capability.key_stop !== 'undefined') {
      return this.sendKey('Stop')
    } else if (typeof capability.key_play !== 'undefined') {
      return this.sendKey('Play')
    } else if (typeof capability.key_back !== 'undefined') {
      return this.sendKey('Back')
    } else if (typeof capability.key_play_pause !== 'undefined') {
      return this.sendKey('PlayPause')
    } else if (typeof capability.key_online !== 'undefined') {
      return this.sendKey('Online')
    } else if (typeof capability.key_record !== 'undefined') {
      return this.sendKey('Record')
    } else if (typeof capability.key_rewind !== 'undefined') {
      return this.sendKey('Rewind')
    } else if (typeof capability.key_fast_forward !== 'undefined') {
      return this.sendKey('FastForward')
    } else if (typeof capability.key_toggle_ambilight !== 'undefined') {
      return this.sendKey('AmbilightOnOff')
    } else if (typeof capability.key_source !== 'undefined') {
      return this.sendKey('Source')
    } else if (typeof capability.key_toggle_subtitles !== 'undefined') {
      return this.sendKey('SubtitlesOnOff')
    } else if (typeof capability.key_teletext !== 'undefined') {
      return this.sendKey('Teletext')
    } else if (typeof capability.key_viewmode !== 'undefined') {
      return this.sendKey('Viewmode')
    } else if (typeof capability.key_watch_tv !== 'undefined') {
      return this.sendKey('WatchTV')
    } else if (typeof capability.key_confirm !== 'undefined') {
      return this.sendKey('Confirm')
    } else if (typeof capability.key_previous !== 'undefined') {
      return this.sendKey('Previous')
    } else if (typeof capability.key_next !== 'undefined') {
      return this.sendKey('Next')
    } else if (typeof capability.key_adjust !== 'undefined') {
      return this.sendKey('Adjust')
    } else if (typeof capability.key_cursor_left !== 'undefined') {
      return this.sendKey('CursorLeft')
    } else if (typeof capability.key_cursor_up !== 'undefined') {
      return this.sendKey('CursorUp')
    } else if (typeof capability.key_cursor_right !== 'undefined') {
      return this.sendKey('CursorRight')
    } else if (typeof capability.key_cursor_down !== 'undefined') {
      return this.sendKey('CursorDown')
    } else if (typeof capability.key_info !== 'undefined') {
      return this.sendKey('Info')
    } else if (typeof capability.key_digit_0 !== 'undefined') {
      return this.sendKey('Digit0')
    } else if (typeof capability.key_digit_1 !== 'undefined') {
      return this.sendKey('Digit1')
    } else if (typeof capability.key_digit_2 !== 'undefined') {
      return this.sendKey('Digit2')
    } else if (typeof capability.key_digit_3 !== 'undefined') {
      return this.sendKey('Digit3')
    } else if (typeof capability.key_digit_4 !== 'undefined') {
      return this.sendKey('Digit4')
    } else if (typeof capability.key_digit_5 !== 'undefined') {
      return this.sendKey('Digit5')
    } else if (typeof capability.key_digit_6 !== 'undefined') {
      return this.sendKey('Digit6')
    } else if (typeof capability.key_digit_7 !== 'undefined') {
      return this.sendKey('Digit7')
    } else if (typeof capability.key_digit_8 !== 'undefined') {
      return this.sendKey('Digit8')
    } else if (typeof capability.key_digit_9 !== 'undefined') {
      return this.sendKey('Digit9')
    } else if (typeof capability.key_dot !== 'undefined') {
      return this.sendKey('Dot')
    } else if (typeof capability.key_options !== 'undefined') {
      return this.sendKey('Options')
    } else if (typeof capability.key_back !== 'undefined') {
      return this.sendKey('Back')
    } else if (typeof capability.key_home !== 'undefined') {
      return this.sendKey('Home')
    } else if (typeof capability.key_find !== 'undefined') {
      return this.sendKey('Find')
    } else if (typeof capability.key_red !== 'undefined') {
      return this.sendKey('RedColour')
    } else if (typeof capability.key_yellow !== 'undefined') {
      return this.sendKey('YellowColour')
    } else if (typeof capability.key_green !== 'undefined') {
      return this.sendKey('GreenColour')
    } else if (typeof capability.key_blue !== 'undefined') {
      return this.sendKey('BlueColour')
    }
  }
}

module.exports = PhilipsTV