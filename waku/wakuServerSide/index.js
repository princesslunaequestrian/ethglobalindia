import "dotenv/config";
import { ethers } from "ethers";
import { createLightNode, waitForRemotePeer, Protocols, createEncoder, createDecoder } from "@waku/sdk";
import { wakuDnsDiscovery } from "@waku/dns-discovery";
import { enrTree } from "@waku/dns-discovery";
import protobuf from "protobufjs";

console.log(ethers.formatEther('1'))

async function checkKeeperCvpAndNativeTokens(contract, provider, kid){
    const keeperData = await contract.getKeeperWorkerAndStake.staticCall(kid);
    const balance = await provider.getBalance(keeperData[0]);
    return {
        activity: keeperData[2],
        cvp: keeperData[1],
        native: balance
    }
}

async function checkJobOwnerCredits(contract, owner){
    const ownerCredits = await contract.jobOwnerCredits.staticCall(owner);
    return {
        credits: ownerCredits
    }
}

async function checkJobCredits(contract, jobKey){
    const data = await contract.getJob.staticCall(jobKey);
    const details = data[3];
    const config = details[0];
    const useJobOwnerCredits = (Number(config) & 2)==2;
    return {
        ownerCreditsUsed: useJobOwnerCredits,
        owner: data[0],
        jobCredits: details[2]
    }
}

async function checkGeneralCredits(contract, jobKey){
    const {ownerCreditsUsed, owner, jobCredits} = await checkJobCredits(contract, jobKey)
    console.log(ownerCreditsUsed);
    console.log(owner);
    console.log(jobCredits);
    console.log('jobcredit check over')
    console.log(Number(ownerCreditsUsed));
    console.log(Number(ownerCreditsUsed) == 1)
    let credits = "";
    if (Number(ownerCreditsUsed) == 1){
        let dat = await checkJobOwnerCredits(contract, owner);
        credits = dat.credits;
        console.log(credits);
    }
    let CHECKING = (Number(ownerCreditsUsed) == 1) ? credits : jobCredits;
    console.log('checking')
    console.log(credits);
    console.log(CHECKING);
    return {
        ownerCreditsUsed: (Number(ownerCreditsUsed) == 1),
        credits: (Number(ownerCreditsUsed) == 1) ? credits : jobCredits,
        target: (Number(ownerCreditsUsed) == 1) ? owner : jobKey,
    }
}

async function setup(){
    const reqBody = process.env.reqBody || "";
    const agentImpl = process.env.agentImpl || "";
    const reqAdditional = process.env.reqAdditional || "";
    const myKey = process.env.myKey || "";
    const wsRpcUrl = process.env.wsRpcUrl || "";
    const networkName = process.env.networkName || "";
    const agentAddr = process.env.agentAddr || "";
    const resp = await fetch(reqBody+agentImpl+reqAdditional+myKey);
    const jsonRes = await resp.json();
    const respJson = await JSON.parse(jsonRes.result);
    //console.log(respJson); 
    var wsProvider = new ethers.WebSocketProvider(wsRpcUrl, Number(networkName));
    let contract = new ethers.Contract(agentAddr, respJson, wsProvider);
    console.log('listening');
    const filters = new Map();
    filters.set(await contract.filters.SlashKeeper().getTopicFilter(), 'SlashKeeper');
    filters.set(await contract.filters.InitiateKeeperSlashing().getTopicFilter(), 'InitiateKeeperSlashing');
    filters.set(await contract.filters.DisableKeeper().getTopicFilter(), 'DisableKeeper');
    filters.set(await contract.filters.FinalizeKeeperActivation().getTopicFilter(), 'FinalizeKeeperActivation');
    filters.set(await contract.filters.InitiateKeeperActivation().getTopicFilter(), 'InitiateKeeperActivation');
    filters.set(await contract.filters.Execute().getTopicFilter(), 'Execute');
    filters.set(await contract.filters.InitiateRedeem().getTopicFilter(), 'InitiateRedeem');
    filters.set(await contract.filters.WithdrawJobCredits().getTopicFilter(), 'WithdrawJobCredits');
    filters.set(await contract.filters.WithdrawJobOwnerCredits().getTopicFilter(), 'WithdrawJobOwnerCredits');
    filters.set(await contract.filters.JobKeeperChanged().getTopicFilter(), 'JobKeeperChanged');
    const filter = [Array.from(filters.keys()).reduce((a,b)=>a.concat(b), [])];
    //const filter = (await contract.filters.SlashKeeper().getTopicFilter()).concat(await contract.filters.InitiateKeeperSlashing().getTopicFilter());
    console.log(filter);
    const node = await createLightNode({ defaultBootstrap: true });
    await node.start();
    await waitForRemotePeer(node, [
        Protocols.LightPush,
        Protocols.Filter,
    ]);

    console.log('node done');


    contract.on(filter, async (event) => {
        console.log("Caught event");
        //(event.)
        //console.log(event);
        //console.log(event.log.topics);
        //console.log(await contract.interface.parseLog({topics: event.log.topics, data:event.log.data}));
        let log = await contract.interface.parseLog({topics: event.log.topics, data:event.log.data});
        console.log(log.name);
        console.log(log.args);
        switch (log.name) {
            case "SlashKeeper":
                var jobKey = log.args[0];
                var slashedKeeper = log.args[1];
                var slasher = log.args[2];
                //check that the slashed keeper has enough tcvp
                const {activity, cvp, native} = await checkKeeperCvpAndNativeTokens(contract, provider, slashedKeeper);
                //push reports on cvp, reports on native, report on slashing
                const encoderCvp = createEncoder({
                    contentTopic: process.env.topicReportCvp, // message content topic
                    ephemeral: true, // allows messages not be stored on the network
                });
                const encoderSlashing = createEncoder({
                    contentTopic: process.env.topicSlashKeeper, // message content topic
                    ephemeral: true, // allows messages not be stored on the network
                });
                const keeperReport = new protobuf.Type('Keeper Report').add(
                    new protobuf.Field("_cvp", 1, "string")
                ).add(
                    new protobuf.Field("_native", 2, "string")
                ).add(
                    new protobuf.Field("_activity", 3, "bool")
                ).add(
                    new protobuf.Field("kid", 4, "string")
                )
                const keeperMessage = keeperReport.create({
                    _cvp: ethers.formatEther(cvp),
                    _native: ethers.formatEther(native),
                    _activity: activity,
                    kid: slashedKeeper.toString(),
                });
                const serialisedMessage = keeperReport.encode(keeperMessage).finish();
                await node.lightPush.send(encoderCvp, {
                    payload: serialisedMessage,
                });
                const slashingReport = new protobuf.Type('Slashing Report').add(
                    new protobuf.Field("kid", 1, "string")
                )
                const slashingMessage = slashingReport.create({kid: slashedKeeper.toString()});
                const serialisedSlashingMessage = slashingReport.encode(slashingMessage).finish();
                await node.lightPush.send(encoderSlashing, {
                    payload: serialisedSlashingMessage,
                });
                
            case "JobKeeperChanged":
                var oldKeeper = log.args[1];
                var newKeeper = log.args[2];
                const oldData = await contract.getKeeperWorkerAndStake.staticCall(oldKeeper);
                const oldKeeperAddress = oldData[0];
                const newData = await contract.getKeeperWorkerAndStake.staticCall(newKeeper);
                const newKeeperAddress = newData[0];
                const cgcData = await checkGeneralCredits(contract, log.args[0]);
                const creditsSource = cgcData.ownerCreditsUsed;
                const credits = cgcData.credits;
                const target = cgcData.target;
                console.log('checking in case')
                console.log(oldKeeperAddress);
                console.log(newKeeperAddress);
                console.log(creditsSource);
                console.log(credits);
                console.log(target);
                const keeperChangeTemplate = new protobuf.Type('KeeperChangeMessage').add(
                    new protobuf.Field("oldKeeperAddr", 1, "string"),
                ).add(
                    new protobuf.Field("newKeeperAddr", 2, "string")
                )
                const creditReportTemplate = new protobuf.Type("Creditreporttemplate").add(
                    new protobuf.Field("creditsAreFromOwner", 1, "bool")
                ).add(
                    new protobuf.Field("creditsLeft", 2, "string")
                ).add(
                    new protobuf.Field("targetContractOrOwner", 3, "string")
                )
                const kcReport = keeperChangeTemplate.create({
                    oldKeeperAddr: oldKeeperAddress,
                    newKeeperAddr: newKeeperAddress
                });
                const crReport = creditReportTemplate.create({
                    creditsAreFromOwner: creditsSource,
                    creditsLeft: ethers.formatEther(credits),
                    targetContractOrOwner: target
                });
                const serialisedkcReport = keeperChangeTemplate.encode(kcReport).finish();
                const serialisedcrReport = creditReportTemplate.encode(crReport).finish();
                const encoderCredit = createEncoder({
                    contentTopic: process.env.topicReportGeneralCredits, 
                    ephemeral: true, 
                });
                const encoderChange = createEncoder({
                    contentTopic: process.env.topicKeeperAssignedJob, 
                    ephemeral: true, 
                });
                await node.lightPush.send(encoderCredit, {
                    payload: serialisedcrReport,
                });
                await node.lightPush.send(encoderChange, {
                    payload: serialisedkcReport,
                });
                console.log("pushed");
            case "Execute":
                var jobKey = log.args[0];
                var jobAddr = log.args[1]
                var kid = log.args[2];
                //check cvp and native token of the keeper, transmit data about exec event
                const {activity_, cvp_, native_} = await checkKeeperCvpAndNativeTokens(contract, provider, slashedKeeper);
                //push reports on cvp, reports on native, report on slashing
                const _encoderCvp = createEncoder({
                    contentTopic: process.env.topicReportCvp, // message content topic
                    ephemeral: true, // allows messages not be stored on the network
                });
                const _keeperReport = new protobuf.Type('Keeper Report').add(
                    new protobuf.Field("_cvp", 1, "string")
                ).add(
                    new protobuf.Field("_native", 2, "string")
                ).add(
                    new protobuf.Field("_activity", 3, "bool")
                ).add(
                    new protobuf.Field("kid", 4, "string")
                )
                const _keeperMessage = _keeperReport.create({
                    _cvp: ethers.formatEther(cvp_),
                    _native: ethers.formatEther(native_),
                    _activity: activity_,
                    kid: kid.toString(),
                });
                const _sKm = _keeperReport.encode(_keeperMessage).finish();
                await node.lightPush.send(_encoderCvp, {
                    payload: _sKm,
                });
                const encoderKeeperExec = createEncoder({
                    contentTopic: process.env.topicExecuteKeeper,
                    ephemeral: true,
                });
                const encoderJobExec = createEncoder({
                    contentTopic: process.env.topicExecuteJob,
                    ephemeral: true,
                });
                const keeperExecTemplate = new protobuf.Type('keeperExecTemplate').add(
                    new protobuf.Field("kidExec", 1, "string")
                );
                const jobExecTemplate = new protobuf.Type('jobExecTemplate').add(
                    new protobuf.Field("jk", 1, "string")
                );
                const keMessage = keeperExecTemplate.create({kidExec: kid.toString()});
                const skeMessage = keeperExecTemplate.encode(keMessage).finish();
                await node.lightPush.send(encoderKeeperExec, {
                    payload: skeMessage,
                });
                const jeMessage = jobExecTemplate.create({jk: jobKey});
                const sjeMessage = jobExecTemplate.encode(jeMessage).finish();
                await node.lightPush.send(encoderJobExec, {
                    payload: sjeMessage,
                });

            case "WithdrawJobCredits":
                const jk = log.args[0];
                const {ocu, o, c} = await checkJobCredits(contract, jk);
                const encodeJC = createEncoder({
                    contentTopic: process.env.topicReportJobCredits,
                    ephemeral: true
                })
                const jct = new protobuf.Type('jobCreditReport').add(
                    new protobuf.Field("ocFlag", 1, "bool")
                ).add(
                    new protobuf.Field("jobOwner", 2, "string")
                ).add(
                    new protobuf.Field("crd", 3, "string")
                );
                const jcm = jct.create({ocFlag: ocu,
                    jobOwner: o,
                    crd: ethers.formatEther(c)
                });
                const sjcm = jct.encode(jcm).finish();
                await node.lightPush.send(encodeJC, {
                    payload: sjcm,
                });
            case "WithdrawJobOwnerCredits":
                const owner_ = log.args[0];
                const {ocs} = await checkJobOwnerCredits(contract, owner_);
                const encodeJOC = createEncoder({
                    contentTopic: process.env.topicReportJobOwnerCredits,
                    ephemeral: true
                })
                const joct = new protobuf.Type('jobOwnerCreditReport').add(
                    new protobuf.Field("crd", 1, "string")
                ).add(
                    new protobuf.Field("jobOwner", 2, "string")
                );
                const jocm = joct.create({ocFlag: ocu,
                    jobOwner: owner_,
                    crd: ethers.formatEther(ocs)
                });
                const sjocm = joct.encode(jocm).finish();
                await node.lightPush.send(encodeJOC, {
                    payload: sjocm,
                });
            default:
                console.log(log.name);
        }
      });
}

await setup();