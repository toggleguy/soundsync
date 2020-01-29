import { EventEmitter } from 'events';
import debug from 'debug';
import _ from 'lodash';

import { AudioSource } from './sources/audio_source';
import { LibrespotSource } from './sources/librespot_source';
import { SourceDescriptor } from './sources/source_type';
import { RemoteSource } from './sources/remote_source';
import { AudioSink } from './sinks/audio_sink';
import { SinkDescriptor } from './sinks/sink_type';
import { RtAudioSink } from './sinks/rtaudio_sink';
import { RemoteSink } from './sinks/remote_sink';
import { getConfigField, updateConfigArrayItem } from '../coordinator/config';
import { getAudioDevices } from '../utils/rtaudio';
import { NullSource } from './sources/null_source';
import { NullSink } from './sinks/null_sink';
import { getLocalPeer } from '../communication/local_peer';

const log = debug(`soundsync:sourcesSinksManager`);

export class AudioSourcesSinksManager extends EventEmitter {
  autodetect: boolean;
  sources: AudioSource[] = [];
  sinks: AudioSink[] = [];

  constructor() {
    super();
    const updateConfigForSource = (source: AudioSource) => {
      if (source.local) {
        updateConfigArrayItem('sources', source.toDescriptor());
      }
    };
    const updateConfigForSink = (sink: AudioSink) => {
      if (sink.local) {
        updateConfigArrayItem('sinks', sink.toDescriptor());
      }
    }
    this.on('sourceUpdate', updateConfigForSource);
    this.on('newLocalSource', updateConfigForSource);

    this.on('sinkUpdate', updateConfigForSink);
    this.on('newLocalSink', updateConfigForSink);
  }

  autodetectDevices = () => {
    log(`Detecting local audio devices`);
    getAudioDevices().forEach((device) => {
      if (device.outputChannels > 0) { // filter microphones, useful for windows / osx
        this.addSink({
          type: 'rtaudio',
          deviceName: device.name,
          name: device.name,
          peerUuid: getLocalPeer().uuid,
        });
      }
    });
  }

  getSourceByUuid = (uuid: string) => _.find(this.sources, {uuid: uuid});
  getSinkByUuid = (uuid: string) => _.find(this.sinks, {uuid: uuid});

  addSource(sourceDescriptor: SourceDescriptor) {
    if (sourceDescriptor.uuid && this.getSourceByUuid(sourceDescriptor.uuid)) {
      this.getSourceByUuid(sourceDescriptor.uuid).updateInfo(sourceDescriptor);
      return;
    }

    const isLocal = !sourceDescriptor.peerUuid || sourceDescriptor.peerUuid === getLocalPeer().uuid;
    log(`Adding source ${sourceDescriptor.name} of type ${sourceDescriptor.type}`);
    let source;
    if (!isLocal) {
      source = new RemoteSource(sourceDescriptor, this);
    } else {
      if (sourceDescriptor.type === 'librespot') {
        source = new LibrespotSource(sourceDescriptor, this);
      } else if (sourceDescriptor.type === 'null') {
        source = new NullSource(sourceDescriptor, this);
      } else {
        // @ts-ignore
        throw new Error(`Unknown source type ${sourceDescriptor.type}`);
      }
    }

    this.sources.push(source);
    if (source.local) {
      this.emit('newLocalSource', source);
    }
  }

  removeSource(uuid: string) {
    const source = _.find(this.sources, {uuid});
    if (!source) {
      log(`Tried to remove unknown source ${uuid}, ignoring`);
      return;
    }
    // TODO: stop source
    log(`Removing source ${source.name} (type: ${source.type} uuid: ${uuid})`);
    this.sources = _.filter(this.sources, (source) => source.uuid !== uuid);
  }

  addSink(sinkDescriptor: SinkDescriptor) {
    if (sinkDescriptor.uuid && this.getSinkByUuid(sinkDescriptor.uuid)) {
      this.getSinkByUuid(sinkDescriptor.uuid).updateInfo(sinkDescriptor);
      return;
    }
    if (sinkDescriptor.type === 'rtaudio' && sinkDescriptor.peerUuid === getLocalPeer().uuid) {
      // when auto detecting rtaudio devices on local host, we cannot compare with the uuid
      // so we need to compare with the device name to see if we need to update the existing
      // or add a new Sink
      const existingSink = _.find(this.sinks, (sink) => sink instanceof RtAudioSink && sink.deviceName === sinkDescriptor.deviceName);
      if (existingSink) {
        existingSink.updateInfo(sinkDescriptor);
        return;
      }
    }

    log(`Adding sink  ${sinkDescriptor.name} of type ${sinkDescriptor.type}`);
    let sink: AudioSink;
    const isLocal = !sinkDescriptor.peerUuid || sinkDescriptor.peerUuid === getLocalPeer().uuid;
    if (!isLocal) {
      sink = new RemoteSink(sinkDescriptor, this);
    } else {
      if (sinkDescriptor.type === 'rtaudio') {
        sink = new RtAudioSink(sinkDescriptor, this);
      } else if (sinkDescriptor.type === 'null') {
        sink = new NullSink(sinkDescriptor, this);
      } else {
        // @ts-ignore
        throw new Error(`Unknown sink type ${sinkDescriptor.type}`);
      }
    }

    this.sinks.push(sink);
    if (sink.local) {
      this.emit('newLocalSink', sink);
    }
  }

  removeSink(uuid: string) {
    const sink = _.find(this.sinks, {uuid});
    if (!sink) {
      log(`Tried to remove unknown sink ${uuid}, ignoring`);
      return;
    }
    // TODO: stop sink
    log(`Removing sink ${sink.name} (type: ${sink.type} uuid: ${uuid})`);
    this.sinks = _.filter(this.sinks, (sink) => sink.uuid !== uuid);
  }

  addFromConfig() {
    const sources = getConfigField('sources');
    sources.forEach((source) => {
      this.addSource(source);
    });
    const sinks = getConfigField('sinks');
    sinks.forEach((sink) => {
      this.addSink(sink);
    });
  }
}

let audioSourcesSinksManager = new AudioSourcesSinksManager();
export const getAudioSourcesSinksManager = () => audioSourcesSinksManager;
