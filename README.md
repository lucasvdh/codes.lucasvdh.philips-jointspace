# Philips Television Jointspace

_This is a work in progress_

A Jointspace connector for Philips TV's supporting models up to 2018

## Functionality
Getters:
- system info
- applications (installed android tv apps)
- channels
- ambilight (current configuration; follow video/audio/etc and the type relax/intense/etc)
- current activity (the currently opened app)
- audio (level, muted)
- powerstate (on/standby)

Setters:
- post key (a key from remote .e.g. CursorUp, Confirm or Standby)
- launch activity (send an intent to open an application)
- ambilight
- audio (set volumne, mute, unmute)
- powerstate
- wake on lan
