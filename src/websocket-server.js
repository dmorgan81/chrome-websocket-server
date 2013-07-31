(function() {

    const HANDSHAKE_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
          MAX_FRAGMENT_LENGTH = 2048;

    function noop() { }

    /**********************************************************************************************
     * Errors                                                                                     *
     *********************************************************************************************/

    function WebSocketServerError(message) {
        this.name = 'WebSocketServerError';
        this.message = message || '';
    }
    WebSocketServerError.prototype = new Error();
    WebSocketServerError.prototype.constructor = WebSocketServerError;


    function WebSocketConnectionError(message) {
        this.name = 'WebSocketConnectionError';
        this.message = message || '';
    }
    WebSocketConnectionError.prototype = new Error();
    WebSocketConnectionError.prototype.constructor = WebSocketConnectionError;

    /**********************************************************************************************
     * Buffer                                                                                     *
     *********************************************************************************************/

    function Buffer(o) {
        this.data = o || new Uint8Array(0);
        this.buffering = false;
    }

    Buffer.prototype.append = function(o) {
        if (!(o instanceof Uint8Array))
            throw new WebSocketConnectionError('Buffer.append: arg not valid type');
        var length = this.data.length, a = new Uint8Array(length + o.length);
        a.set(this.data);
        a.set(o, length);
        this.data = a;
        return this;
    };

    Buffer.prototype.toString = function() {
        var s = '';
        if (this.data.length > 0xFFFF) {
            for (var i = 0; i < this.data.length; i+=64) {
                s += String.fromCharCode.apply(null, this.data.subarray(i, i+64));
            }
        } else {
            s = String.fromCharCode.apply(null, this.data);
        }
        return s;
    };

    /**********************************************************************************************
     * Frames                                                                                     *
     *********************************************************************************************/

    function ServerFrame(connection, opcode) {
        this.rsv1 = this.rsv2 = this.rsv3 = 0;
        this.connection = connection;
        this.opcode = opcode;
        this.length = 0;
        this.payload = new Uint8Array(0);
    }

    ServerFrame.prototype.append = function(o) {
        var a;
        if (typeof o === 'string') {
            a = new Uint8Array(o.length);
            for (var i = 0; i < o.length; i++) a[i] = o.charCodeAt(i);
            o = a;
        } else if (o instanceof ArrayBuffer) {
            o = new Uint8Array(o);
        } else if (!(o instanceof Uint8Array)) {
            throw new WebSocketConnectionError('ServerFrame.append: arg not valid type');
        }
        a = new Uint8Array(this.length + o.length);
        a.set(this.payload);
        a.set(o, this.length);
        this.payload = a;
        this.length += o.length;
        return this;
    };

    ServerFrame.prototype.write = function(callback) {
        var offset = 2, a;
        if (this.length > 125) {
            if (this.length > MAX_FRAGMENT_LENGTH) {
                var fragback = callback, fragframe = new ServerFrame(this.connection, 0x80);
                fragframe.append(this.payload.subarray(MAX_FRAGMENT_LENGTH));
                this.opcode = this.opcode ^ 0x80;
                this.length = MAX_FRAGMENT_LENGTH;
                this.payload = this.payload.subarray(0, MAX_FRAGMENT_LENGTH);
                callback = function() { fragframe.write(fragback) };
            }
            offset += 2;
            a = new Uint8Array(this.length + offset);
            a[1] = 126;
            a[2] = this.length >>> 8;
            a[3] = this.length & 0xFF;
        } else {
            a = new Uint8Array(this.length + offset);
            a[1] = this.length;
        }
        a[0] = this.opcode;
        a.set(this.payload, offset);
        chrome.socket.write(this.connection._sid, a.buffer, callback || noop);
    };

    function ClientFrame(connection, o) {
        this.connection = connection;
        this.data = o;
        this.fin = (o[0] & 0x80) >>> 7;
        this.rsv1 = (o[0] & 0x40) >>> 6;
        this.rsv2 = (o[0] & 0x20) >>> 5;
        this.rsv3 = (o[0] & 0x10) >>> 4;
        this.opcode = o[0] & 0x0F;
        this.mask = (o[1] & 0x80) >> 7;
        this.length = o[1] & 0x7F;

        var offset = 2, a;
        if (this.length === 126) {
            this.size = (o[2] << 8) | o[3];
            offset += 2;
        } else if (this.length === 127) {
            a = o.subarray(2, 10);
            this.size = 0;
            for (var i = 0; i < a.length; i++) this.size = (this.size << 8) | a[i];
            offset += 8;
        } else {
            this.size = this.length;
        }

        if (this.mask === 1) {
            this.key = o.subarray(offset, offset+4);
            offset += 4;
        }

        this.offset = offset;
        var payload = o.subarray(this.offset), unmasked;
        if (this.mask === 1) {
            unmasked = new Uint8Array(this.size);
            for (var i =0; i < payload.length; i++) unmasked[i] = payload[i] ^ this.key[i%4];
            payload = unmasked;
        }
        this.payload = payload;
        this.leftovers = this.data.subarray(payload.length + this.offset);
    }

    ClientFrame.prototype.isValid = function() {
        if (this.rsv1 !== 0 || this.rsv2 !== 0 || this.rsv3 !== 0 || this.mask !== 1)
            return false;
        if ((this.opcode === 0x08 || this.opcode === 0x09 || this.opcode === 0x0A)
                && (this.fin !== 1 || this.length > 125))
            return false;
        return true;
    };

    ClientFrame.prototype.isComplete = function() {
        return this.size === (this.data.length - this.leftovers.length - this.offset);
    };

    /**********************************************************************************************
     * WebSocketConnection                                                                        *
     *********************************************************************************************/

    /* Using CryptoJS. This can be changed to suit needs */
    function sha1(o) {
        return CryptoJS.SHA1(o);
    }

    /* Using CryptoJS. This can be changed to suit needs */
    function base64(o) {
        return o.toString(CryptoJS.enc.Base64);
    }

    function WebSocketConnection(o) {
        var s = String.fromCharCode.apply(null, new Uint8Array(o.data)),
            parts = s.trim().split('\n')
            method = parts.shift();
            headers = {},
            that = this;
        parts.forEach(function(part) {
            var h = part.trim().split(': ');
            headers[h.shift()] = h.join('');
        });

        this._sid = o.sid;
        this._onOpen = o.open || noop;
        this._onClose = o.close || noop;
        this._closed = true;
        this._requestBuffer = new Buffer();
        this._messageBuffer = new Buffer();

        this.onMessage = noop;

        if (headers['Connection'].toLowerCase() === 'upgrade'
                && headers['Upgrade'].toLowerCase() === 'websocket') {
            if (parseInt(headers['Sec-WebSocket-Version']) !== 13) {
                s = 'HTTP/1.1 400 Bad Request\r\n' +
                    'Sec-WebSocket-Version: 13\r\n\r\n',
                headers = new Uint8Array(s.length);
                for (var i = 0; i < s.length; i++) headers[i] = s.charCodeAt(i);
                chrome.socket.write(this._sid, headers.buffer, noop);
            } else {
                s = base64(sha1(headers['Sec-WebSocket-Key'] + HANDSHAKE_MAGIC));
                s = 'HTTP/1.1 101 Switching Protocols\r\n' +
                    'Connection: upgrade\r\n' +
                    'Upgrade: websocket\r\n' +
                    'Sec-WebSocket-Accept: ' + s + '\r\n\r\n',
                headers = new Uint8Array(s.length);
                for (var i = 0; i < s.length; i++) headers[i] = s.charCodeAt(i);
                chrome.socket.write(this._sid, headers.buffer, function(writeinfo) {
                    if (writeinfo.bytesWritten < 0)
                        throw new WebSocketConnectionError('chrome.socket.write = ' + writeinfo.bytesWritten);
                    that._closed = false;
                    that._onOpen.apply(that, [ that ]);
                    that._loop();
                });
            }
        } else {
            s = 'HTTP/1.1 400 Bad Request\r\n\r\n',
            headers = new Uint8Array(s.length);
            for (var i = 0; i < s.length; i++) headers[i] = s.charCodeAt(i);
            chrome.socket.write(this._sid, headers.buffer, noop);
        }
    }

    WebSocketConnection.prototype.close = function(code) {
        var that = this, frame;
        if (this._closed) throw new WebSocketConnectionError('close: closed');
        if (code) {
            frame = new ServerFrame(this, 0x88, 2);
            frame.payload[0] = code >>> 8;
            frame.payload[1] = code & 0xFF;
        } else {
            frame = new ServerFrame(this, 0x88);
        }
        frame.write(function() {
            chrome.socket.disconnect(that._sid);
            chrome.socket.destroy(that._sid);
            that._closed = true;
            that._onClose.apply(that, [ that, code ]);
        });
    };

    WebSocketConnection.prototype.send = function(o) {
        if (this._closed) throw new WebSocketConnectionError('send: closed');
        new ServerFrame(this, typeof o === 'string' ? 0x81 : 0x82).append(o).write();
        return this;
    };

    WebSocketConnection.prototype._loop = function() {
        var that = this;
        if (this._closed) throw new WebSocketConnectionError('_loop: closed');
        chrome.socket.read(this._sid, 8192, function(readinfo) {
            var a = new Uint8Array(readinfo.data), buffer = that._requestBuffer, frame;
            if (buffer.buffering) {
                buffer.append(a);
                if (buffer.length > buffer.data.length) {
                    that._loop();
                    return;
                }
                frame = new ClientFrame(that, buffer.data);
                that._requestBuffer = new Buffer();
            } else {
                frame = new ClientFrame(that, a);
                if (frame.size + frame.offset > a.length) {
                    buffer.buffering = true;
                    buffer.append(a);
                    buffer.length = frame.size + frame.offset;
                    that._loop();
                    return;
                }
            }
            that._process(frame);
        });
    };

    WebSocketConnection.prototype._process = function(frame) {
        var that = this;

        if (!frame.isValid()) {
            this.close(1002);
            return;
        }

        switch (frame.opcode) {
            case 0:
            case 1:
            case 2:
                var buffer = this._read(frame);
                if (buffer.error) {
                    this.close(1002);
                    return;
                }
                if (!buffer.buffering) {
                    this._messageBuffer = new Buffer();
                    if (buffer.opcode === 1) {
                        var s = buffer.toString();
                        this.onMessage(s);
                    } else {
                        this.onMessage(buffer.data.buffer);
                    }
                }
                break;
            case 8:
                if (frame.size > 0) {
                    var code = (frame.payload[0] << 8) | frame.payload[1];
                    this.close(code);
                } else {
                    this.close();
                }
                return;
                break;
            case 9:
                this._pong(frame);
                break;
            case 10:
                break;
            default:
                this.close(1002);
                return;
        }

        if (frame.leftovers.length > 0) {
            var leftovers = frame.leftovers, buffer = this._requestBuffer;
            buffer.buffering = true;
            buffer.append(leftovers);
            if (leftovers.length === 1) {
                this._frame();
            } else {
                var len = leftovers[1] & 0x7F;
                if ((len === 126 && leftovers.length < 32)
                        || (len === 127 && leftovers.length < 80)) {
                    this._frame();
                } else {
                    frame = new ClientFrame(this, buffer.data);
                    if (frame.isComplete()) {
                        this._requestBuffer = new Buffer();
                        this._process(frame);
                    } else {
                        buffer.length = frame.size + frame.offset;
                        this._loop();
                    }
                }
            }
        } else {
            this._loop();
        }
    };

    WebSocketConnection.prototype._frame = function() {
        var that = this;
        chrome.socket.read(this._sid, 8192, function(readinfo) {
            var buffer = that._requestBuffer, frame;
            buffer.append(new Uint8Array(readinfo.data));
            frame = new ClientFrame(that, buffer.data);
            if (frame.isComplete()) {
                that._requestBuffer = new Buffer();
                that._process(frame);
            } else {
                buffer.length = frame.size + frame.offset;
                that._loop();
            }
        });
    };

    WebSocketConnection.prototype._read = function(frame) {
        if (this._closed) throw new WebSocketConnectionError('_read: closed');
        var buffer = this._messageBuffer;
        if (buffer.buffering && frame.opcode !== 0) {
            buffer.error = true;
            return buffer;
        }
        buffer.buffering = (frame.fin !== 1);
        if (!buffer.opcode) {
            buffer.error = (frame.opcode === 0);
            buffer.opcode = frame.opcode;
        }
        buffer.append(frame.payload);
        return buffer;
    };

    WebSocketConnection.prototype._pong = function(frame) {
        if (this._closed) throw new WebSocketConnectionError('_pong: closed');
        new ServerFrame(this, 0x8A).append(frame.payload).write();
    };

    /**********************************************************************************************
     * WebSocketServer                                                                            *
     *********************************************************************************************/

    function WebSocketServer(port, callbacks) {
        callbacks = callbacks || {};

        // private fields
        this._port = port;
        this._sid = null;
        this._connections = [];

        // callbacks
        this._onStartup = callbacks.startup || noop;
        this._onShutdown = callbacks.shutdown || noop;
        this._onConnectionOpen = callbacks.open || noop;
        this._onConnectionClose = callbacks.close || noop;
    }

    WebSocketServer.prototype.shutdown = function() {
        if (this._sid === null) throw new WebSocketServerError('server not started');
        this._connections.forEach(function(connection) {
            connection.close(1001); // going away
        });
        chrome.socket.disconnect(this._sid);
        chrome.socket.destroy(this._sid);
        this._sid = null;
        this._onShutdown.appy(this);
    };

    WebSocketServer.prototype.startup = function() {
        var that = this;
        if (this._sid !== null) throw new WebSocketServerError('server already started');
        chrome.socket.create('tcp', function(info) {
            that._sid = info.socketId;
            chrome.socket.listen(that._sid, '127.0.0.1', that._port, function(result) {
                if (result !== 0)
                    throw new WebSocketServerError('chrome.socket.listen = ' + result);
                that._onStartup.apply(that);
                that._accept();
            });
        });
    };

    WebSocketServer.prototype._accept = function() {
        var that = this;
        if (this._sid === null) throw new WebSocketServerError('server not started');
        chrome.socket.accept(this._sid, function(acceptinfo) {
            chrome.socket.read(acceptinfo.socketId, function(readinfo) {
                var connection;
                if (readinfo.resultCode < 0) {
                    console.error('chrome.socket.read = %d', readinfo.resultCode);
                } else {
                    connection = new WebSocketConnection({
                        sid : acceptinfo.socketId,
                        data : readinfo.data,
                        open : that._onConnectionOpen,
                        close : function(conn, code) {
                            var index = that._connections.indexOf(conn);
                            if (index !== -1) that._connections.splice(index, 1);
                            that._onConnectionClose.apply(that, [ conn, code ]);
                        },
                        open : function(conn) {
                            that._connections.push(conn);
                            that._onConnectionOpen.apply(that, [ conn ]);
                        }
                    });
                }
                that._accept();
            });
        });
    };

    this.WebSocketServer = WebSocketServer;

})();
