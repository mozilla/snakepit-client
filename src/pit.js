#! /usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')
const program = require('commander')
const request = require('request')
const readlineSync = require('readline-sync')
const { execSync, execFileSync } = require('child_process')
const terminfo = require('terminfo')()

const USER_FILE = '.pituser.txt'
const CONNECT_FILE = '.pitconnect.txt'
const REQUEST_FILE = '.pitrequest.txt'

const githubGitPrefix = 'git@github.com:'
const githubHttpsPrefix = 'https://github.com/'

function fail(message) {
    console.error('Command failed: ' + message)
    process.exit(1)
}

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

function promptAliasInfo(alias) {
    alias = alias || {}
    if (!alias.name) {
        alias.name = readlineSync.question('Exact resource name: ')
    }
    return alias
}

function callPit(verb, resource, content, callback, asStream) {
    if (content instanceof Function) {
        asStream = callback
        callback = content
        content = undefined
    }
    var connectFile = CONNECT_FILE
    if(!fs.existsSync(connectFile)) {
        connectFile = path.join(os.homedir(), connectFile)
        if(!fs.existsSync(connectFile)) {
            console.error('Unable to find connectivity info about your pit.')
            console.error(
                'If you know your pit\'s URL, ' +
                'use "pit connect <URL>" to configure the connection.'
            )
            console.error(
                'If your pit admin provided a "' + CONNECT_FILE +
                '" file, place it either in your home directory' +
                '(as default pit) or the (overruling) project root.'
            )
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

    var userFile = USER_FILE
    var username
    var token = ''

    function sendRequest(verb, resource, content, callback, asStream) {
        if (content instanceof Function) {
            asStream = callback
            callback = content
            content = undefined
        }
        let resourceUrl = pitUrl + '/' + resource
        let creq = request[verb]({
            url: resourceUrl,
            agentOptions: agentOptions,
            headers: {
                'X-Auth-Token': token,
                'content-type': 'application/json'
            },
            body: content ? JSON.stringify(content) : undefined
        })
        .on('error', err => fail('Unable to reach pit: ' + err.code))
        .on('response', res => {
            if (res.statusCode === 401) {
                var password = readlineSync.question('Please enter password: ', { hideEchoBack: true })
                authenticate(
                    username,
                    password,
                    () => sendRequest(verb, resource, content, callback, asStream)
                )
            } else if (asStream) {
                callback(res.statusCode, creq)
            } else {
                chunks = []
                creq.on('data', chunk => chunks.push(chunk))
                creq.on('end', () => {
                    let body = Buffer.concat(chunks)
                    let contentType = res.headers['content-type']
                    if (contentType && contentType.startsWith('application/json')) {
                        try {
                            body = JSON.parse(body.toString())
                        } catch (ex) {
                            fail('Problem parsing pit response.')
                        }
                    }
                    callback(res.statusCode, body)
                })
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
                console.error(
                    'Unable to authenticate. If user "' + username +
                    '" is not valid anymore, remove "' + USER_FILE +
                    '" from this directory or your home folder and start over.'
                )
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
        sendRequest(verb, resource, content, callback, asStream)
    }

    if(!fs.existsSync(userFile)) {
        userFile = path.join(os.homedir(), userFile)
        if(!fs.existsSync(userFile)) {
            userFile = USER_FILE
            console.log('No user info found. Seems like a new user or first time login from this machine.')
            username = readlineSync.question('Please enter an existing or new username: ')
            var userPath = 'users/' + username
            sendRequest('get', userPath + '/exists', function(code, body) {
                if (code == 200) {
                    console.log('The user already exists.')
                    var password = readlineSync.question(
                        'Please enter password (or Ctrl-C to abort): ',
                        { hideEchoBack: true }
                    )
                    authenticate(username, password, sendCommand)
                } else {
                    console.log('Found no user of that name.')
                    var register = readlineSync.question(
                        'Do you want to register this usename (yes|no)? ',
                        { trueValue: ['yes', 'y'], falseValue: ['no', 'n'] }
                    )
                    if (register) {
                        user = promptUserInfo()
                        sendRequest('put', userPath, user, function(code, body) {
                            if (code == 200) {
                                authenticate(username, user.password, sendCommand)
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

const jobStates = {
    NEW: 0,
    PREPARING: 1,
    WAITING: 2,
    STARTING: 3,
    RUNNING: 4,
    STOPPING: 5,
    CLEANING: 6,
    DONE: 7,
    FAILED: 8
}

const jobStateNames = [
    'NEW',
    'PRE',
    'WAI',
    'STA',
    'RUN',
    'STO',
    'CLN',
    'FIN',
    'ARC'
]

const nodeStateNames = [
    'OFFLINE',
    'ONLINE'
]

const indent = '  '
const entityUser = 'user:<username>'
const entityNode = 'node:<node name>'
const entityJob = 'node:<job number>'
const entityAlias = 'alias:<alias>'

const entityDescriptors = {
    'user': {
        'id': 'Username',
        'fullname': 'Full name',
        'email': 'E-Mail address',
        'groups': (o, v) => v && ['Groups', v.join(' ')],
        'autoshare': (o, v) => v && ['Auto share', v.join(' ')],
        'admin': 'Is administrator'
    },
    'node': {
        'id': 'Node name',
        'address': 'Address',
        'state': (o, v) => ['State', nodeStateNames[v]],
        'since': 'Since',
        'port': 'Port',
        'user': 'Remote user',
        'resources': (o, v) => v && [
            'Resources',
            '\n' + v.map((r, i) =>
                '  ' + i + ': "' + r.name + '"' +
                (r.alias ? ' aka "' + r.alias + '"' : '') +
                ' (' + r.type + ' ' + r.index + ')' +
                (r.groups ? ' - Groups: ' + r.groups.join(' ') : '')
            ).join('\n')
        ]
    },
    'job': {
        'id': 'Job number',
        'description': 'Title',
        'user': 'Owner',
        'groups': (o, v) => v && ['Groups', v.join(' ')],
        'error': (o, v) => v && ['Error', '"' + v + '"'],
        'provisioning': 'Provisioning',
        'clusterRequest': 'Request',
        'clusterReservation': 'Reservation',
        'state': (o, v) => ['State', jobStateNames[v] + (v == jobStates.WAITING ? ' (position ' + o.schedulePosition + ')' : '')],
        'stateChanges': (o, v) => v && [
            'State changes',
            '\n' + Object.keys(v).map(state => '  ' + jobStateNames[state] + ': ' + v[state]).join('\n')
        ]
    },
    'alias': {
        'name': 'Resource\'s name'
    }
}

const httpCodes = {
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    407: 'Proxy Authentication Required',
    408: 'Request Time-out',
    409: 'Conflict',
    410: 'Gone',
    411: 'Length Required',
    412: 'Precondition Failed',
    413: 'Request Entity Too Large',
    414: 'Request-URI Too Large',
    415: 'Unsupported Media Type',
    416: 'Requested Range Not Satisfiable',
    417: 'Expectation Failed',
    418: 'I\'m a teapot',
    422: 'Unprocessable Entity',
    423: 'Locked',
    424: 'Failed Dependency',
    425: 'Unordered Collection',
    426: 'Upgrade Required',
    428: 'Precondition Required',
    429: 'Too Many Requests',
    431: 'Request Header Fields Too Large',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Time-out',
    505: 'HTTP Version Not Supported',
    506: 'Variant Also Negotiates',
    507: 'Insufficient Storage',
    509: 'Bandwidth Limit Exceeded',
    510: 'Not Extended',
    511: 'Network Authentication Required'
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
    printLine('Node properties: "address" (mandatory), "port", "cvd" (CUDA_VISIBLE_DEVICES), "user".')
}

function printAliasPropertyHelp() {
    printLine('alias properties: "name".')
}

function printExample(line) {https://github.com/jamestalmage/cli-table2/blob/master/advanced-usage.md
    printLine(indent + '$ ' + line)
}

function splitPair(value, separator, ...names) {
    var obj = {}
    var parts = value.split(separator)
    for (let index in parts) {
        obj[names[index]] = parts[index]
    }
    return obj
}

function parseEntity(entity, indexAllowed) {
    pair = splitPair(entity, ':', 'type', 'id', 'index')
    pair.plural = (pair.type == 'alias') ? 'aliases' : (pair.type + 's')
    if (!indexAllowed && pair.hasOwnProperty('index')) {
        fail('Indices not allowed for ' + pair.type + ' entities')
    }
    return pair
}

function parseAssignment(assignment) {
    return splitPair(assignment, '=', 'property', 'value')
}

function parseEntityProperties(entity, properties) {
    let obj = {}
    if (properties) {
        properties.forEach(assignment => {
            assignment = parseAssignment(assignment)
            if (assignment.property == 'cvd') {
                assignment.value = assignment.value.split(',').map(v => Number(v))
            } else if (assignment.property == 'autoshare') {
                assignment.value = assignment.value.split(',')
            }
            obj[assignment.property] = assignment.value
        })
    }
    return obj
}

function formatDuration(d) {
    let two = n => ('0' + n).slice(-2)
    return d.days > 99 ? d.days + 'd' : two(d.days) + 'd ' + two(d.hours) + ':' + two(d.minutes) + ':' + two(d.seconds)
}

function evaluateResponse(code, body) {
    if (code > 299) {
        fail((body && body.message) || httpCodes[code] || code)
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

function showPreparationLog(jobNumber) {
    callPit('get', 'jobs/' + jobNumber + '/preplog', (code, res) => {
        evaluateResponse(code)
        res.on('data', chunk => {
            process.stdout.write(chunk)
        })
    }, true)
}

function showLog(jobNumber, groupIndex, processIndex) {
    groupIndex = groupIndex || 0
    processIndex = processIndex || 0
    let logPath = 'jobs/' + jobNumber + '/groups/' + groupIndex + '/processes/' + processIndex + '/log'
    callPit('get', logPath, (code, res) => {
        evaluateResponse(code)
        res.on('data', chunk => {
            process.stdout.write(chunk)
        })
    }, true)
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
        printExample('pit add alias:gtx1070 name="GeForce GTX 1070"')
        printLine()
        printEntityHelp(entityUser, entityNode)
        printPropertyHelp()
        printUserPropertyHelp()
        printNodePropertyHelp()
        printAliasPropertyHelp()
    })
    .action(function(entity, properties) {
        entity = parseEntity(entity)
        if(entity.type == 'user' || entity.type == 'node' || entity.type == 'alias') {
            let obj = parseEntityProperties(entity, properties)
            if (entity.type == 'user') {
                obj = promptUserInfo(obj)
            } else if (entity.type == 'node') {
                obj = promptNodeInfo(obj)
            } else {
                obj = promptAliasInfo(obj)
            }
            callPit('put', entity.plural + '/' + entity.id, obj, evaluateResponse)
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
        printExample('pit remove job:123')
        printExample('pit remove alias:gtx1070')
        printLine()
        printEntityHelp(entityUser, entityNode, entityJob, entityAlias)
    })
    .action(function(entity) {
        entity = parseEntity(entity)
        if(entity.type == 'user' || entity.type == 'node' || entity.type == 'job' || entity.type == 'alias') {
            callPit('del', entity.plural + '/' + entity.id, evaluateResponse)
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
        printExample('pit set alias:gtx1070 name="GeForce GTX 1070"')
        printExample('pit set job:123 autoshare=students,professors')
        printLine()
        printEntityHelp(entityUser, entityNode, entityJob, entityAlias)
        printPropertyHelp()
        printUserPropertyHelp()
        printNodePropertyHelp()
        printAliasPropertyHelp()
    })
    .action(function(entity, assignments) {
        entity = parseEntity(entity)
        if(entity.type == 'user' || entity.type == 'node') {
            let obj = parseEntityProperties(entity, assignments)
            callPit('put', entity.plural + '/' + entity.id, obj, evaluateResponse)
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
        printExample('pit get alias:gtx1070 name')
        printExample('pit get job:123 autoshare')
        printLine()
        printEntityHelp(entityUser, entityNode, entityJob, entityAlias)
        printPropertyHelp()
        printUserPropertyHelp()
        printNodePropertyHelp()
        printAliasPropertyHelp()
    })
    .action(function(entity, property) {
        entity = parseEntity(entity)
        var descriptor = entityDescriptors[entity.type]
        if(descriptor) {
            callPit('get', entity.plural + '/' + entity.id, function(code, body) {
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
        printExample('pit show groups')
        printExample('pit show nodes')
        printExample('pit show jobs')
        printExample('pit show aliases')
        printExample('pit show user:paul')
        printExample('pit show node:machine1')
        printExample('pit show job:235')
        printExample('pit show alias:gtx1070')
        printLine()
        printEntityHelp('me', 'users', 'groups', 'nodes', 'jobs', 'aliases', entityUser, entityNode, entityJob, entityAlias)
    })
    .action(function(entity, options) {
        if(entity === 'users' || entity === 'groups' || entity === 'nodes' || entity === 'jobs' || entity === 'aliases') {
            callPit('get', entity, function(code, body) {
                if (code == 200) {
                    body.forEach(obj => console.log(obj))
                } else {
                    evaluateResponse(code, body)
                }
            })
        } else {
            if (entity == 'me') {
                entity = { type: 'user', plural: 'users', id: '~' }
            } else {
                entity = parseEntity(entity)
            }
            var descriptor = entityDescriptors[entity.type]
            if(descriptor) {
                callPit('get', entity.plural + '/' + entity.id, function(code, body) {
                    if (code == 200) {
                        let attributes = []
                        let maxLen = 0
                        for (let property of Object.keys(descriptor)) {
                            let name = descriptor[property]
                            let attribute
                            if (name instanceof Function) {
                                attribute = name(body, body[property])
                            } else if (body.hasOwnProperty(property)) {
                                attribute = [name, body[property]]
                            }
                            if (attribute) {
                                if (attribute[0].length > maxLen) {
                                    maxLen = attribute[0].length
                                }
                                attributes.push(attribute)
                            }
                        }
                        for (let attribute of attributes) {
                            let name = attribute[0] + ':' + Array(maxLen - attribute[0].length + 1).join(' ')
                            console.log(name + ' ' + attribute[1])
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
    .command('add-group <entity> <group>')
    .description('adds the entity to the access group')
    .on('--help', function() {
        printIntro()
        printExample('pit add-group node:machine1 professors')
        printExample('pit add-group node:machine1:0 students')
        printExample('pit add-group user:paul students')
        printExample('pit add-group job:123 students')
        printLine()
        printEntityHelp(entityUser, entityNode, entityJob, 'node:<node name>:<resource index>')
    })
    .action(function(entity, group) {
        entity = parseEntity(entity, true)
        if (entity.type == 'node' || entity.type == 'user' || entity.type == 'job') {
            let resource = entity.hasOwnProperty('index') ? '/resources/' + entity.index : ''
            let p = entity.plural + '/' + entity.id + resource + '/groups/' + group
            callPit('put', p, evaluateResponse)
        } else {
            fail('Unsupported entity type "' + entity.type + '"')
        }
    })

program
    .command('remove-group <entity> <group>')
    .description('removes the entity from the access group')
    .on('--help', function() {
        printIntro()
        printExample('pit remove-group node:machine1 professors')
        printExample('pit remove-group node:machine1:0 students')
        printExample('pit remove-group user:paul students')
        printExample('pit remove-group job:123 students')
        printLine()
        printEntityHelp(entityUser, entityNode, entityJob, 'node:<node name>:<resource index>')
    })
    .action(function(entity, group) {
        entity = parseEntity(entity, true)
        if (entity.type == 'node' || entity.type == 'user' || entity.type == 'job') {
            let resource = entity.hasOwnProperty('index') ? '/resources/' + entity.index : ''
            let p = entity.plural + '/' + entity.id + resource + '/groups/' + group
            callPit('del', p, evaluateResponse)
        } else {
            fail('Unsupported entity type "' + entity.type + '"')
        }
    })

program
    .command('stop <jobNumber>')
    .description('stops a running job')
    .on('--help', function() {
        printIntro()
        printExample('pit stop 1234')
    })
    .action(function(jobNumber) {
        callPit('post', 'jobs/' + jobNumber + '/stop', evaluateResponse)
    })

program
    .command('run <title> [clusterRequest]')
    .alias('put')
    .description('enqueues current directory as new job')
    .option('-p, --private', 'prevents automatic sharing of this job')
    .option('-c, --continue <jobNumber>', 'continues job with provided number by copying its "keep" directory over to the new job')
    .option('-w, --watch', 'immediately starts watching the job log output on secondary buffer')
    .option('-l, --log', 'waits for and prints job\'s log output')
    .on('--help', function() {
        printIntro()
        printExample('pit put 2:[8:gtx1070]')
        printLine()
        printLine('"title" is a short text that will later help identifying the job and its purpose.')
        printLine('"clusterRequest" is an expression to specify resources this job requires from the cluster.')
        printLine('It\'s a comma separated list of "process requests".')
        printLine('Each "process request" specifies the number of process instances and (divided by colon and in braces) which resources to allocate for one process instances (on one node).')
        printLine('The example above will allocate 2 process instances. For each process, 8 "gtx1070" resources will get allocated.')
        printLine('You can also provide a "' + REQUEST_FILE + '" file with the same content in your project root as default value.')
    })
    .action(function(title, clusterRequest, options) {
        var tracking = runCommand('git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
        var ob = tracking.split('/')
        if (ob.length != 2) {
            fail('Problem getting tracked git remote and branch')
        }
        var origin = ob[0]
        var branch = ob[1]
        var hash = runCommand('git', 'rev-parse', tracking)
        var originUrl = runCommand('git', 'remote', 'get-url', origin)
        if (originUrl.startsWith(githubGitPrefix)) {
            originUrl = githubHttpsPrefix + originUrl.substr(githubGitPrefix.length)
        }
        var diff = runCommand('git', 'diff', '--no-prefix', tracking)
        if (!clusterRequest && fs.existsSync(REQUEST_FILE)) {
            clusterRequest = fs.readFileSync(REQUEST_FILE, 'utf-8').trim()
        }
        if (!clusterRequest) {
            fail('No resources requested from cluster. Please provide them either through command line or through a "' + REQUEST_FILE + '" file in your project root.')
        }
        if (title.length > 20) {
            fail('Job title too long (20 characters max)')
        }
        callPit('post', 'jobs', {
            origin: originUrl,
            hash: hash,
            diff: diff,
            clusterRequest: clusterRequest,
            description: title,
            private: options.private,
            continueJob: options.continue
        }, (code, body) => {
            if (code == 200) {
                console.log('Job number: ' + body.id)
                console.log('Remote:     ' + origin + ' <' + originUrl + '>')
                console.log('Hash:       ' + hash)
                console.log('Diff LoC:   ' + diff.split('\n').length)
                console.log('Resources:  "' + clusterRequest + '"')
                if (options.watch) {
                    enterSecondary()
                    clearScreen()
                    showPreparationLog(body.id)
                    showLog(body.id, 0, 0)
                } else if (options.log) {
                    console.log()
                    showPreparationLog(body.id)
                    showLog(body.id, 0, 0)
                }
            } else {
                evaluateResponse(code, body)
            }
        })
    })

program
    .command('log <jobNumber> [groupIndex] [processIndex]')
    .description('continuously watches job\'s log output')
    .option('-w, --watch', 'continuous watching')
    .on('--help', function() {
        printIntro()
        printExample('pit log p')
        printExample('pit log 1234')
        printExample('pit log 1234 0 1')
        printLine()
        printLine('"jobNumber" is the number of the job who\'s log should be shown.')
        printLine('"groupIndex" is the index number of a specific process group. if set to "p", the preparation log is shown and "processIndex" ignored.')
        printLine('"processIndex" is the index number of a process within the specified process group.')
    })
    .action((jobNumber, groupIndex, processIndex, options) => {
        if (options.watch) {
            enterSecondary()
            clearScreen()
        }
        if (groupIndex == 'p') {
            showPreparationLog(jobNumber)
        } else {
            showLog(jobNumber, groupIndex, processIndex)
        }
    })

program
    .command('download <jobNumber>')
    .description('downloads job directory as .tar.gz archive')
    .on('--help', function() {
        printIntro()
        printExample('pit download 1234')
    })
    .action((jobNumber) => {
        let filename = 'job' + jobNumber + '.tar.gz'
        if (fs.existsSync(filename)) {
            fail('Unable to download: File "' + filename + '" already exists')
        }
        callPit('get', 'jobs/' + jobNumber + '/targz', (code, res) => {
            evaluateResponse(code)
            res.pipe(fs.createWriteStream(filename))
        }, true)
    })

program
    .command('status')
    .description('prints a job status report')
    .option('-w, --watch', 'continuous watching')
    .on('--help', function() {
        printIntro()
        printExample('pit status')
    })
    .action(function(options) {
        let updateStatus = () => {
            if (options.watch) {
                enterSecondary()
            }
            callPit('get', 'status', function(code, jobGroups) {
                if (code == 200) {
                    if (options.watch) {
                        clearScreen()
                    }
                    let fixed = 6 + 3 + 12 + 3 + 3 + 10 + 20 + 7
                    let rest = process.stdout.columns
                    if (rest && rest >= fixed) {
                        rest = rest - fixed
                    } else {
                        rest = 30
                    }
                    writeFragment('JOB', 6, true, ' ')
                    writeFragment('S', 3, true, ' ')
                    writeFragment('SINCE', 12, false, ' ')
                    writeFragment('UC%', 3, true, ' ')
                    writeFragment('UM%', 3, true, ' ')
                    writeFragment('USER', 10, false, ' ')
                    writeFragment('TITLE', 20, false, ' ')
                    writeFragment('RESOURCE', rest, false, '\n')

                    let printJobs = (jobs, caption) => {
                        if (jobs.length > 0) {
                            if (caption) {
                                console.log(caption + ':')
                            }
                            for(let job of jobs) {
                                writeFragment(job.id, 6, true, ' ')
                                writeFragment(jobStateNames[job.state], 3, true, ' ')
                                writeFragment(formatDuration(job.since), 12, false, ' ')
                                writeFragment(Math.round(job.utilComp), 3, true, ' ')
                                writeFragment(Math.round(job.utilMem), 3, true, ' ')
                                writeFragment(job.user, 10, false, ' ')
                                writeFragment(job.description, 20, false, ' ')
                                writeFragment(job.clusterReservation || job.clusterRequest, rest, false, '\n')
                            }
                        }
                    }
                    printJobs(jobGroups.running, 'Running')
                    printJobs(jobGroups.waiting, 'Waiting')
                    printJobs(jobGroups.done, 'Done')
                } else {
                    evaluateResponse(code, jobGroups)
                }
                if (options.watch) {
                    setTimeout(updateStatus, 1000)
                }
            })
        }
        updateStatus()
    })

program.parse(process.argv)

if (!process.argv.slice(2).length) {
    program.outputHelp();
}

function writeFragment(text, len, right, padding) {
    text = text + ''
    text = text.substr(0, len)
    padding = typeof padding == 'string' ? padding : ''
    let space = Array(len - text.length + 1).join(' ')
    text = right ? (space + text) : (text + space)
    process.stdout.write(text + padding)
}

var inSecondary = false

function enterSecondary() {
    if (!global.inSecondary) {
        process.stdout.write(terminfo.saveCursor)
        process.stdout.write(terminfo.enterCaMode)
        process.stdout.write(terminfo.cursorInvisible)
        global.inSecondary = true
    }
}

function exitSecondary() {
    if (global.inSecondary) {
        process.stdout.write(terminfo.cursorVisible)
        process.stdout.write(terminfo.exitCaMode)
        process.stdout.write(terminfo.restoreCursor)
        global.inSecondary = false
    }
}

function clearScreen() {
    process.stdout.write(terminfo.clearScreen)
    process.stdout.write(terminfo.cursorHome)
}

process.on('SIGINT', () => {
    exitSecondary()
    process.exit(0)
})

process.on('exit', () => {
    exitSecondary()
})

