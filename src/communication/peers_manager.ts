import { EventEmitter } from 'events';
import _ from 'lodash';
import debug from 'debug';

import { SOUNDSYNC_VERSION } from '../utils/constants';
import { SoundSyncHttpServer } from './http_server';
import { WebrtcPeer } from './wrtc_peer';
import { getLocalPeer } from './local_peer';
import {
  ControllerMessage,
  ControllerMessageHandler,
} from './messages';
import { Peer } from './peer';

const log = debug('soundsync:wrtc');
let peersManager: PeersManager;

export class PeersManager extends EventEmitter {
  peers: {[uuid: string]: Peer} = {};

  constructor() {
    super();
    if (peersManager) {
      throw new Error('Cannot create multiple peers managers');
    }
    log(`Creating peer manager with peer uuid ${getLocalPeer().uuid}`);
    this.peers[getLocalPeer().uuid] = getLocalPeer();
    this.on('newConnectedPeer', (peer) => {
      peer.sendControllerMessage({
        type: 'peerDiscovery',
        peersUuid: _.map(_.filter(this.peers, (p) => p.state === 'connected'), (p) => p.uuid),
      });
    });
  }

  attachToSignalingServer(httpServer: SoundSyncHttpServer) {
    httpServer.router.post('/connect_webrtc_peer', async (ctx) => {
      const {
        name, uuid, description, version, instanceUuid,
      } = ctx.request.body;
      if (version !== SOUNDSYNC_VERSION) {
        ctx.throw(`Different version of Soundsync, please check each client is on the same version.\nOwn version: ${SOUNDSYNC_VERSION}\nOther peer version: ${version}`, 400);
      }
      log(`Received new connection request from HTTP from peer ${name} with uuid ${uuid}`);
      const existingPeer = this.peers[uuid];
      if (existingPeer && existingPeer instanceof WebrtcPeer && existingPeer.instanceUuid !== instanceUuid) {
        existingPeer.disconnect(true);
      }
      const peer = new WebrtcPeer({
        uuid,
        name,
        host: ctx.request.ip,
        instanceUuid,
      });

      this.peers[uuid] = peer;
      const responseDescription = await peer.handlePeerConnectionMessage({ description });

      peer.log(`Responding with offer`);
      ctx.body = {
        status: 'ok',
        description: responseDescription,
        uuid: getLocalPeer().uuid,
        name: getLocalPeer().name,
        instanceUuid: getLocalPeer().instanceUuid,
      };
    });

    // httpServer.router.post('/ice_candidate', async (ctx) => {
    //   const { uuid, iceCandidates } = ctx.request.body;
    //   if (iceCandidates) {
    //     for (const iceCandidate of iceCandidates) {
    //       await this.peers[uuid].connection.addIceCandidate(iceCandidate);
    //     }
    //   }
    //   ctx.body = {
    //     status: 'ok',
    //     candidates: this.peers[uuid].candidates,
    //   };
    //   this.peers[uuid].candidates = [];
    // });
  }

  async joinPeerWithHttpApi(host: string, uuid?: string, forceIfSamePeerUuid?: boolean) {
    const peer = new WebrtcPeer({
      name: 'remote',
      uuid: uuid || `placeholderForHttpApiJoin_${host}`,
      host,
      instanceUuid: 'placeholder',
    });
    this.peers[peer.uuid] = peer;
    await peer.connectFromHttpApi(host, forceIfSamePeerUuid);
  }

  broadcastPeersDiscoveryInfo = () => {
    this.broadcast({
      type: 'peerDiscovery',
      peersUuid: _.map(_.filter(this.peers, (p) => p.state === 'connected'), (p) => p.uuid),
    });
  }

  async broadcast(message: ControllerMessage, ignorePeerByUuid: string[] = []) {
    const sendToPeer = (peer) => {
      if (ignorePeerByUuid.includes(peer.uuid)) {
        return Promise.resolve(false);
      }
      return peer.sendControllerMessage(message);
    };
    await Promise.all(_.map(this.peers, sendToPeer));
  }

  getPeerByUuid = (uuid: string, autoConnect = true) => {
    if (!this.peers[uuid]) {
      const peer = new WebrtcPeer({
        uuid,
        name: 'remote',
        host: 'unknown',
        instanceUuid: 'placeholder',
      });
      this.peers[uuid] = peer;
      if (autoConnect) {
        peer.connectFromOtherPeers();
      }
    }
    return this.peers[uuid];
  }

  onControllerMessage: ControllerMessageHandler<this> = (type, handler) => this.on(`controllerMessage:${type}`, ({ message, peer }) => handler(message, peer))
}

export const getPeersManager = () => {
  if (!peersManager) {
    peersManager = new PeersManager();
  }
  return peersManager;
};
