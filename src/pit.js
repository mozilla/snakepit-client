#! /usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')
const program = require('commander')
const request = require('request')
const readlineSync = require('readline-sync')


function runCommand(verb, resource, content, callback, params) {
    var connectFile = '.pitconnect.txt'
    if(!fs.existsSync(connectFile)) {
        connectFile = path.join(os.homedir(), connectFile)
        if(!fs.existsSync(connectFile)) {
            console.error('Unable to find connectivity info about your pvar it.')
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

    var userFile = '.pituser.txt'
    var username
    var token = ''

    function sendRequest(verb, resource, content, callback, params) {
        if (content instanceof Function) {
            params = callback
            callback = content
            content = undefined
        }
        var resourceUrl = pitUrl + '/' + resource
        request[verb]({
            url: resourceUrl,
            agentOptions: agentOptions,
            headers: { 'X-Auth-Token': token },
            json: true,
            body: content
        }, function(error, response, body) {
            if(error) {
                console.error('Unable to reach pit: ' + error.code)
                process.exit(1)
            } else if (response.statusCode === 401) {
                var password = readlineSync.question('Please enter password: ', { hideEchoBack: true })
                authenticate(username, password, function() {
                    sendRequest(verb, resource, content, callback, params)
                })
            } else if (callback instanceof Function) {
                var obj
                callback(response.statusCode, body)
            }
        })
    }

    function authenticate(username, password, callback) {
        sendRequest('post', 'users/' + username + '/authenticate', { password: password }, function(code, body) {
            if (code == 200) {
                token = body.token
                fs.writeFile(userFile, username + '\n' + token, function(err) {
                    if(err) {
                        console.error('Unable to store user info: ' + err)
                        process.exit(1)
                    } else {
                        if (callback instanceof Function) {
                            callback()
                        }
                    }
                })
            } else {
                console.error('Unable to authenticate. If user "' + username + '" is not valid anymore, remove ".pituser.txt" from this directory or your home folder and start over.')
                process.exit(1)
            }
        })
    }

    function loadUser() {
        var userContent = fs.readFileSync(userFile, 'utf-8').split('\n')
        username = userContent[0]
        token = userContent[1]
    }

    function sendCommand() {
        sendRequest(verb, resource, content, callback, params)
    }

    if(!fs.existsSync(userFile)) {
        userFile = path.join(os.homedir(), userFile)
        if(!fs.existsSync(userFile)) {
            userFile = '.pituser.txt'
            console.log('No user info found. Seems like a new user or first time login from this machine.')
            username = readlineSync.question('Please enter an existing or new username: ')
            var userPath = 'users/' + username
            sendRequest('get', userPath + '/exists', function(code, body) {
                if (code == 200) {
                    console.log('The user already exists.')
                    var password = readlineSync.question('Please enter password (or Ctrl-C to abort): ', { hideEchoBack: true })
                    authenticate(username, password, sendCommand)
                } else {
                    console.log('Found no user of that name.')
                    var register = readlineSync.question('Do you want to register this usename (yes|no)? ', { trueValue: ['yes', 'y'], falseValue: ['no', 'n'] })
                    if (register) {
                        var fullname = readlineSync.question('Full name: ')
                        var email = readlineSync.questionEMail('E-Mail address: ')
                        var password = readlineSync.questionNewPassword('New password: ')
                        var user = { fullname: fullname, email: email, password: password }
                        sendRequest('put', userPath, user, function(code, body) {
                            if (code == 200) {
                                authenticate(username, password, sendCommand)
                            } else {
                                console.error('Unable to register user.')
                                exit(1)
                            }
                        })
                    } else {
                        exit(0)
                    }
                }
            })
        } else {
            loadUser()
            sendCommand()
        }
    } else {
        loadUser()
        sendCommand()
    }
}

const indent = '  '
const entityUser = 'user:<username>'
const entityNode = 'node:<node name>'
const entityJob = 'node:<job number>'

function printLine(msg) {
    console.log(msg ? (indent + (msg || '')) : '')
}

function printIntro() {
    printLine()
    printLine(indent + 'Examples:')
    printLine()
}

function printEntityHelp() {
    printLine('Accepted values for "entity": ' + Array.prototype.slice.call(arguments).join(', ') + '.')
}

function printPropertyHelp() {
    printLine('Properties are pairs of property-name and value of the form "property=value".')
}

function printUserPropertyHelp() {
    printLine('User properties: "fullname", "email", "password" (prompted if omitted).')
}

function printNodePropertyHelp() {
    printLine('Node properties: "address" (mandatory), "port", "gpus" (comma separated CUDA indices), "user".')
}

function printExample(line) {
    printLine(indent + '$ ' + line)
}

program
    .version('0.0.1')

program
    .command('add <entity> [properties...]')
    .description('adds an entity to the system')
    .on('--help', function() {
        printIntro()
        printExample('pit add user:paul email=paul@x.y password=secret')
        printExample('pit add node:machine1 address=192.168.2.2')
        printLine()
        printEntityHelp(entityUser, entityNode)
        printPropertyHelp()
        printUserPropertyHelp()
        printNodePropertyHelp()
    })
    .action(function(entity, properties) {

    })

program
    .command('remove <entity>')
    .description('removes an entity from the system')
    .option("-f, --force", "no security question")
    .action(function(entity, options) {

    })

program
    .command('set <entity> <properties...>')
    .description('sets properties of an entity')
    .on('--help', function() {
        printIntro()
        printExample('pit set user:paul email=new@x.y')
        printExample('pit set node:machine1 address=192.168.2.1')
        printLine()
        printEntityHelp(entityUser, entityNode)
        printPropertyHelp()
        printUserPropertyHelp()
        printNodePropertyHelp()
    })
    .action(function(entity, properties) {

    })

program
    .command('get <entity> <property>')
    .description('gets a property of an entity')
    .on('--help', function() {
        printIntro()
        printExample('pit get user:paul email')
        printExample('pit get node:machine1 address')
        printLine()
        printEntityHelp(entityUser, entityNode)
        printPropertyHelp()
        printUserPropertyHelp()
        printNodePropertyHelp()
    })
    .action(function(entity, property) {

    })

program
    .command('show <entity>')
    .description('shows info about an entity')
    .on('--help', function() {
        printIntro()
        printExample('pit show users')
        printExample('pit show nodes')
        printExample('pit show jobs')
        printExample('pit show user:paul')
        printExample('pit show node:machine1')
        printExample('pit show job:235')
        printLine()
        printEntityHelp('users', 'nodes', 'jobs', entityUser, entityNode, entityJob)
    })
    .action(function(entity, options) {
        if(entity === 'users') {
            runCommand('get', 'users', undefined, function(code, body) {
                body.forEach(user => console.log(user))
            })
        } else if (entity === 'jobs') {

        } else {
            console.log('Unknown entity')
        }
    })

program
    .command('watch [entity]')
    .description('continuously watches job\'s log output, job backlog, cluster stats or node stats')
    .on('--help', function() {
        printIntro()
        printExample('pit watch')
        printExample('pit watch jobs')
        printExample('pit watch job:5576')
        printExample('pit watch nodes')
        printExample('pit watch node:machine1')
        printLine()
        printEntityHelp('nodes', 'jobs', entityNode, entityJob)
    })
    .action(function(options) {

    })

program
    .command('run')
    .description('enqueues current directory as new job')
    .option("-w, --watch", "immediately starts watching the job")
    .on('--help', function() {
        printIntro()
        printExample('pit run')
    })
    .action(function(options) {

    })

program.parse(process.argv)

if (!process.argv.slice(2).length) {
    program.outputHelp();
}

