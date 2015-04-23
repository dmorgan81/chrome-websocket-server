(function() {
    new WebSocketServer(9080, {
        open : function(connection) {
            connection.send('Welcome to chrome-websocket-server');
            connection.onMessage = function(o) {
                connection.send(o.toUpperCase());
            }
        }
    }).startup();
})();
