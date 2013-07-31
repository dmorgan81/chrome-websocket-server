(function() {
    new WebSocketServer(9080, {
        open : function(connection) {
            connection.onMessage = function(o) {
                connection.send(o);
            }
        }
    }).startup();
})();
