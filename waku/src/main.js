import {
    createLightNode,
    waitForRemotePeer,
    Protocols,
    createEncoder,
    createDecoder
} from "waku/sdk";

import {
    wakuDnsDiscovery
} from "waku/dns-discovery";

//elements
const bStartStop = document.getElementById("start/stop");
const bConnect = document.getElementById("connect");
const bStatus = document.getElementById("status");

wakuDnsDiscovery();

//bootstrap node
const peers = [
    "/ip4/65.21.65.159/tcp/34563/p2p/16Uiu2HAm6xUCcV5Bja6weyPXxvR9UdZzQn8tzT69n2hWWN9SnogZ",
    "/ip4/65.21.65.159/tcp/34565/ws/p2p/16Uiu2HAm6xUCcV5Bja6weyPXxvR9UdZzQn8tzT69n2hWWN9SnogZ"
];


//flow
console.log("Creating and starting the node...")
const node = await createLightNode({
    libp2p: {
        peerDiscovery: [
            bootstrap({ list: peers }),
        ]
    }
})
    .then((wn) => {
        console.log("Node started.")
        bStartStop.textContent = "Stop";
        return wn;
    })

await waitForRemotePeer

console.log(node.libp2p.getPeers());

//functions
async function startstop() {
    if (!!node.isStarted()) {
        console.log("Stopping the node...")
        node.stop();
        bStartStop.textContent = "Start";
    } else {
        console.log("Starting the node...");
        node.start();
        bStartStop.textContent = "Stop";
    }
}


async function status() {
    if (!!!node.isStarted()) {
        console.log("Node is stopped");
        return;
    }
    console.log("Node is started!");
    var peers_ = node.libp2p.getPeers();
    for (let peer in peers_) {
        console.log(peer);
    }
    console.log("Peers: ", peers_);
    return;
}

//callbacks

bStartStop.onclick = function (ev) {
    startstop();
}

bStatus.onclick = function (ev) {
    status();
}

