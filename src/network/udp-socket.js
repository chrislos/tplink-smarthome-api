const dgram = require('dgram');

const { encrypt, decrypt } = require('tplink-smarthome-crypto');

const TplinkSocket = require('./tplink-socket');
const { replaceControlCharacters } = require('../utils');

class UdpSocket extends TplinkSocket {
  // eslint-disable-next-line class-methods-use-this
  get socketType() {
    return 'UDP';
  }

  logDebug(...args) {
    this.log.debug(`[${this.socketId}] UdpSocket${args.shift()}`, ...args);
  }

  async createSocket() {
    return super.createSocket(() => {
      return new Promise((resolve, reject) => {
        this.socket = dgram.createSocket('udp4');

        // Polyfill stub for Node < v8.7
        if (this.socket.getRecvBufferSize === undefined) {
          this.socket.getRecvBufferSize = () => {};
        }
        // Polyfill stub for Node < v8.7
        if (this.socket.getSendBufferSize === undefined) {
          this.socket.getSendBufferSize = () => {};
        }

        this.socket.on('error', err => {
          this.logDebug(': createSocket:error');
          reject(err);
        });

        this.socket.bind(() => {
          this.logDebug(
            '.createSocket(): listening on %j',
            this.socket.address()
          );
          this.socket.removeAllListeners('error');
          this.isBound = true;
          resolve(this.socket);
        });
      });
    });
  }

  close() {
    super.close(() => {
      this.socket.close();
    });
  }

  /**
   * @private
   */
  async sendAndGetResponse(payload, port, host, timeout) {
    return new Promise((resolve, reject) => {
      let timer;
      const setSocketTimeout = socketTimeout => {
        if (timer != null) clearTimeout(timer);
        if (socketTimeout > 0) {
          timer = setTimeout(() => {
            this.logDebug(`: socketTimeout(${socketTimeout})`);
            reject(new Error('UDP Timeout'));
          }, socketTimeout);
        }
      };
      setSocketTimeout(timeout);

      const { socket } = this;
      socket.removeAllListeners('message');
      socket.removeAllListeners('close');

      socket.on('message', (msg, rinfo) => {
        let decryptedMsg;
        try {
          this.logDebug(': socket:data rinfo: %j', rinfo);
          setSocketTimeout(0);

          decryptedMsg = decrypt(msg).toString('utf8');
          this.logDebug(
            `: socket:data message:${replaceControlCharacters(decryptedMsg)}`
          );
          return resolve(JSON.parse(decryptedMsg));
        } catch (err) {
          this.log.error(
            `Error processing UDP message: From:[%j] SO_RCVBUF:[%d]${'\n'}  msg:[%o]${'\n'}  decrypted:[${replaceControlCharacters(
              decryptedMsg
            )}]`,
            rinfo,
            socket.getRecvBufferSize(),
            msg
          );
          return reject(err);
        }
      });

      socket.on('close', () => {
        try {
          this.logDebug(': socket:close');
          setSocketTimeout(0);
        } finally {
          reject(new Error('UDP Socket Closed'));
        }
      });

      socket.on('error', err => {
        this.logDebug(': socket:error');
        reject(err);
      });

      const encryptedPayload = encrypt(payload);
      this.logDebug(': socket:send payload.length', encryptedPayload.length);

      socket.send(
        encryptedPayload,
        0,
        encryptedPayload.length,
        port,
        host,
        err => {
          if (err) {
            try {
              this.logDebug(
                `: socket:send socket:error length: ${
                  encryptedPayload.length
                } SO_SNDBUF:${socket.getSendBufferSize()} `,
                err
              );
              if (this.isBound) this.close();
            } finally {
              reject(err);
            }
            return;
          }
          this.logDebug(': socket:send sent');
        }
      );
    });
  }
}

module.exports = UdpSocket;
