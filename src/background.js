(function() {

    new WebSocketServer(9001, {
        open : function(connection) {
            connection.send('Welcome to chrome-websocket-server');
            connection.onMessage = function(o) {
                if (typeof o === 'string') {
                    connection.send(o.toUpperCase());
                } else {
                    connection.close(1003, 'binary not supported');
                }
            }
        }
    }).startup();

})();
