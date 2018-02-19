#! /usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')
const program = require('commander')
const request = require('request')


function runCommand(verb, resource, content, params) {
    var connectFile = '.pitconnect.txt'
    if(!fs.existsSync(connectFile)) {
        connectFile = path.join(os.homedir(), connectFile)
        if(!fs.existsSync(connectFile)) {
            console.error('Unable to find connectivity info about your pit.')
            console.error('If you know your pit\'s URL, use "pit connect <URL>" to configure the connection.')
            console.error('If your pit admin provided a ".pitconnect.txt" file, place it either in your home directory (as default pit) or the (overruling) project root.')
            process.exit(1)
        }
    }
    var connectContent = fs.readFileSync(connectFile, 'utf-8').split('\n')
    var pitUrl = connectContent[0]
    connectContent.shift()
    var agentOptions = null
    if (connectContent.length > 0) {
        agentOptions = { ca: connectContent.join('\n') }
    }
    var resourceUrl = pitUrl + '/' + resource
    request[verb]({
        url: resourceUrl, agentOptions: agentOptions,
        json: true
    }, function(error, response, body) {
        console.log(response.statusCode)
        console.log(response.headers['content-type'])
        console.log(body)
    })
}

program
    .version('0.0.1')

program
    .command('run')
    .description('enqueues current directory as new job')
    .option("-w, --watch", "immediately starts watching the job")
    .action(function(options) {
        var watch = options.watch
    })

program.parse(process.argv)

runCommand('get', 'users')