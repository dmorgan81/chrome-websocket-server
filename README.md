# Chrome WebSocket Server
## Why?
> What the heck? Why in the world would you want to run a WebSocket server inside your browser?
> -- Somebody, somewhere

That's a good question, Somebody. The answer, though, would have to come from Google because they are the ones that allowed Chrome apps to [open TCP and UDP ports](http://developer.chrome.com/apps/app_network.html). I figured since the capability to run a TCP server in a Chrome app existed there should at least be a way for two instances of a Chrome browser to talk to each other.
Really, though, I got an idea for a peer-to-peer Chrome app and I needed some sort of way to ensure peers could talk reliably.

## Implementation Details
So a large part of [RFC 6455](http://www.rfc-editor.org/rfc/rfc6455.txt) is implemented. It passes most of the [Autobahn Testsuite](http://autobahn.ws/testsuite); the bits related to handling invalid UTF-8 still need to be implemented.

## Use
I've included this in a sample Chrome app that does nothing more than start up a server listening on port 9080. The server does nothing more than echo any text frames it gets from the client. It should be good enough to get you up and running.

## Considerations
* Because Chrome does not implement secure sockets all communication with the server will be unencrypted. That means no support for wss:// so make sure you're not passing around sensitive information in the clear.
* Just because the server supports sending and receiving large payloads, it's probably not the best idea. Payloads aren't buffered to disk so something that's very large will end up using a lot of memory.

## External Dependencies
* [crypto-js](https://code.google.com/p/crypto-js/) for the SHA1 hasing and Base64 encoding of the Sec-WebSocket-Accept response header during the handshake. This can be replaced by anything that can do SHA1 hashing and Base64 encoding.

## Licensing
Check out the file LICENSE. tl;dr this code is public domain. Feel free to use it however you want.
