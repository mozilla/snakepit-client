#! /usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')
const program = require('commander')
const request = require('request')
const readlineSync = require('readline-sync')
const { execSync, execFileSync } = require('child_process')

function promptUserInfo(user) {
    user = user || {}
    if (!user.fullname) {
        user.fullname = readlineSync.question('Full name: ')
    }
    if (!user.email) {
        user.email = readlineSync.questionEMail('E-Mail address: ')
    }
    if (!user.password) {
        user.password = readlineSync.questionNewPassword('New password: ')
    }
    return user
}

function promptNodeInfo(node) {
    node = node || {}
    if (!node.address) {
        node.address = readlineSync.question('Node\'s domain name or IP address: ')
    }
    return node
}

function callPit(verb, resource, content, callback, params) {
    if (content instanceof Function) {
        params = callback
        callback = content
        content = undefined
    }
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
                        user = promptUserInfo()
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

const entityDescriptors = {
    'user': {
        'id': 'Username',
        'fullname': 'Full name',
        'email': 'E-Mail address',
        'admin': 'Is administrator'
    },
    'node': {
        'id': 'Node name',
        'addresss': 'Address',
        'port': 'Port',
        'user': 'Remote user',
        'gpus': 'GPUs'
    }
}

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
    printLine('User properties: "fullname", "email", "password" (prompted if omitted), "admin" ("yes" or "no").')
}

function printNodePropertyHelp() {
    printLine('Node properties: "address" (mandatory), "port", "gpus" (comma separated CUDA indices), "user".')
}

function printExample(line) {
    printLine(indent + '$ ' + line)
}

function splitPair(value, separator, name1, name2) {
    var obj = {}
    value = value.split(separator)
    if (value.length == 2) {
        obj[name1] = value[0]
        obj[name2] = value[1]
    }
    return obj
}

function parseEntity(entity) {
    return splitPair(entity, ':', 'type', 'id')
}

function parseAssignment(assignment) {
    return splitPair(assignment, '=', 'property', 'value')
}

function fail(message) {
    console.error('Command failed: ' + message)
    process.exit(1)
}

function evaluateResponse(code, body) {
    if (code == 409) {
        fail('Not allowed')
    } else if (code > 299) {
        fail(code)
    }
}

function runCommand() {
    var args = Array.prototype.slice.call(arguments)
    var file = args.shift()
    try {
        return execFileSync(file, args, { encoding: 'utf8' }).trim()
    } catch (err) {
        var message = err.message.includes('ENOENT') ? 'Not found' : err.message
        fail('Problem executing "' + file + '": ' + message)
    }
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
        var obj = {}
        entity = parseEntity(entity)
        if(entity.type == 'user' || entity.type == 'node') {
            if (properties) {
                properties.forEach(assignment => {
                    assignment = parseAssignment(assignment)
                    obj[assignment.property] = assignment.value
                })
            }
            if (entity.type == 'user') {
                obj = promptUserInfo(obj)
            } else {
                obj = promptNodeInfo(obj)
            }
            callPit('put', entity.type + 's/' + entity.id, obj, evaluateResponse)
        } else {
            fail('Unknown entity type "' + entity.type + '"')
        }
    })

program
    .command('remove <entity>')
    .alias('rm')
    .description('removes an entity from the system')
    .on('--help', function() {
        printIntro()
        printExample('pit remove user:paul')
        printExample('pit remove node:machine1')
        printLine()
        printEntityHelp(entityUser, entityNode)
    })
    .action(function(entity) {
        entity = parseEntity(entity)
        if(entity.type == 'user' || entity.type == 'node') {
            callPit('del', entity.type + 's/' + entity.id, evaluateResponse)
        } else {
            fail('Unsupported entity type "' + entity.type + '"')
        }
    })

program
    .command('set <entity> <assignments...>')
    .description('sets properties of an entity')
    .on('--help', function() {
        printIntro()
        printExample('pit set user:paul email=x@y.z fullname="Paul Smith"')
        printExample('pit set node:machine1 adremotedress=192.168.2.1')
        printLine()
        printEntityHelp(entityUser, entityNode)
        printPropertyHelp()
        printUserPropertyHelp()
        printNodePropertyHelp()
    })
    .action(function(entity, assignments) {
        var obj = {}
        entity = parseEntity(entity)
        if(entity.type == 'user' || entity.type == 'node') {
            assignments.forEach(assignment => {
                assignment = parseAssignment(assignment)
                obj[assignment.property] = assignment.value
            })
            callPit('put', entity.type + 's/' + entity.id, obj, evaluateResponse)
        } else {
            fail('Unsupported entity type "' + entity.type + '"')
        }
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
        entity = parseEntity(entity)
        var descriptor = entityDescriptors[entity.type]
        if(descriptor) {
            callPit('get', entity.type + 's/' + entity.id, function(code, body) {
                if (code == 200) {
                    console.log(body[property])
                } else {
                    evaluateResponse(code, body)
                }
            })
        } else {
            fail('Unsupported entity type "' + entity.type + '"')
        }
    })

program
    .command('show <entity>')
    .description('shows info about an entity')
    .on('--help', function() {
        printIntro()
        printExample('pit show me')
        printExample('pit show users')
        printExample('pit show nodes')
        printExample('pit show jobs')
        printExample('pit show user:paul')
        printExample('pit show node:machine1')
        printExample('pit show job:235')
        printLine()
        printEntityHelp('me', 'users', 'nodes', 'jobs', entityUser, entityNode, entityJob)
    })
    .action(function(entity, options) {
        if(entity === 'users' || entity === 'nodes' || entity === 'jobs') {
            callPit('get', entity, function(code, body) {
                if (code == 200) {
                    body.forEach(obj => console.log(obj))
                } else {
                    evaluateResponse(code, body)
                }
            })
        } else {
            if (entity == 'me') {
                entity = { type: 'user', id: '~' }
            } else {
                entity = parseEntity(entity)
            }
            var descriptor = entityDescriptors[entity.type]
            if(descriptor) {
                callPit('get', entity.type + 's/' + entity.id, function(code, body) {
                    if (code == 200) {
                        for (var property in body) {
                            if (body.hasOwnProperty(property)) {
                                var name = descriptor[property] || property
                                console.log(name + ': ' + body[property])
                            }
                        }
                    } else {
                        evaluateResponse(code, body)
                    }
                })
            } else {
                fail('Unsupported entity type "' + entity.type + '"')
            }
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
    .command('put [description]')
    .alias('run')
    .description('enqueues current directory as new job')
    .option('-w, --watch', 'immediately starts watching the job')
    .on('--help', function() {
        printIntro()
        printExample('pit put')
    })
    .action(function(description, options) {
        var tracking = runCommand('git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
        var ob = tracking.split('/')
        if (ob.length != 2) {
            fail('Problem getting tracked git remote and branch')
        }
        var origin = ob[0]
        var branch = ob[1]
        var hash = runCommand('git', 'rev-parse', tracking)
        var originUrl = runCommand('git', 'remote', 'get-url', origin)
        var diff = runCommand('git', 'diff', tracking)
        console.log('Remote: ' + origin + ' <' + originUrl + '>')
        console.log('Hash: ' + hash)
        console.log('Diff LOC: ' + diff.split('\n').length)
        callPit('post', 'jobs', {
            origin: originUrl,
            hash: hash,
            diff: diff,
            description: description || null
        }, evaluateResponse)
    })

program.parse(process.argv)

if (!process.argv.slice(2).length) {
    program.outputHelp();
}

