#! /usr/bin/env node
const fs = require('fs')
const os = require('os')
const net = require('net')
const url = require('url')
const tmp = require('tmp')
const path = require('path')
const WebSocket = require('ws')
const websocket = require('websocket-stream')
const request = require('request')
const filesize = require('filesize')
const program = require('commander')
const multiplex = require('multiplex')
const ProgressBar = require('progress')
const readlineSync = require('readline-sync')
const { spawn, execFileSync } = require('child_process')

const USER_FILE = '.pituser.txt'
const CONNECT_FILE = '.pitconnect.txt'
const REQUEST_FILE = '.pitrequest.txt'

const githubGitPrefix = 'git@github.com:'
const githubHttpsPrefix = 'https://github.com/'

var globalunmount
var debugHttp = false
var userPassword

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
    if (!node.endpoint) {
        node.endpoint = readlineSync.question('LXD endpoint: ')
    }
    if (!node.password) {
        node.password = readlineSync.question('LXD endpoint password: ', { hideEchoBack: true })
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

function promptGroupInfo(group) {
    group = group || {}
    if (!group.title) {
        group.title = readlineSync.question('Group title: ')
    }
    return group
}

function getUserPassword() {
    if (typeof userPassword !== 'string') {
        userPassword = readlineSync.question('Please enter password: ', { hideEchoBack: true })
    }
    return userPassword
}

function callPit(verb, resource, content, callback, callOptions) {
    if (content instanceof Function) {
        callOptions = callback
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

    function sendRequest(verb, resource, content, callback, callOptions) {
        if (content instanceof Function) {
            callOptions = callback
            callback = content
            content = undefined
        }
        let headers = {
            'X-Auth-Token': token,
            'Content-Type': 'application/json'
        }
        if (callOptions && callOptions.offset) {
            headers['Range'] = 'bytes=' + callOptions.offset + '-'
        }
        if (callOptions && callOptions.headers) {
            headers = Object.assign(headers, callOptions.headers)
        }
        let creqoptions = {
            url: pitUrl + '/' + resource,
            agentOptions: agentOptions,
            headers: headers
        }
        if (debugHttp) {
            console.log('SENDING', verb, creqoptions.url)
        }
        if (content && (typeof content.pipe != 'function')) {
            creqoptions.body = JSON.stringify(content)
            if (debugHttp) {
                console.log('- BODY', creqoptions.body)
            }
        }
        let creq = request[verb](creqoptions)
        .on('error', err => fail('Unable to reach pit: ' + err.code))
        .on('response', res => {
            if (debugHttp) {
                console.log('RECEIVING CODE', res.statusCode)
            }
            if (res.statusCode === 401) {
                authenticate(
                    username,
                    getUserPassword(),
                    () => sendRequest(verb, resource, content, callback, callOptions)
                )
            } else if (callOptions && callOptions.asStream) {
                if (debugHttp) {
                    console.log('- STREAM')
                }
                callback(res.statusCode, creq)
            } else {
                let chunks = []
                creq.on('data', chunk => chunks.push(chunk))
                creq.on('end', () => {
                    let body = Buffer.concat(chunks)
                    let contentType = res.headers['content-type']
                    if (contentType && contentType.startsWith('application/json')) {
                        try {
                            body = JSON.parse(body.toString())
                            if (debugHttp) {
                                console.log('- BODY', body)
                            }
                        } catch (ex) {
                            fail('Problem parsing pit response.')
                        }
                    }
                    callback(res.statusCode, body)
                })
            }
        })
        if (content && (typeof content.pipe == 'function')) {
            content.pipe(creq)
        }
    }

    function authenticate(username, password, callback) {
        sendRequest('post', 'users/' + username + '/authenticate', { password: password }, function(code, body) {
            if (code == 200) {
                token = body.token
                fs.writeFile(userFile, username + '\n' + token, { mode: parseInt('600', 8) }, function(err) {
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
        if (verb == 'connection') {
            callback({
                url: pitUrl,
                token: token,
                ca: agentOptions && agentOptions.ca
            })
        } else {
            sendRequest(verb, resource, content, callback, callOptions)
        }
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
                    authenticate(username, getUserPassword(), sendCommand)
                } else {
                    console.log('Found no user of that name.')
                    var register = readlineSync.question(
                        'Do you want to register a new user with this name (yN)? ',
                        { trueValue: ['yes', 'y'] }
                    )
                    if (register === true) {
                        let user = promptUserInfo()
                        sendRequest('put', userPath, user, function(code, body) {
                            if (code == 200) {
                                authenticate(username, user.password, sendCommand)
                            } else {
                                console.error((body && body.message) || 'Unable to register user')
                                process.exit(1)
                            }
                        })
                    } else {
                        process.exit(0)
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

function getConnectionSettings(callback) {
    callPit('connection', null, null, callback)
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
const entityGroup = 'group:<group name>'
const entityNode = 'node:<node name>'
const entityJob = 'job:<job number>'
const entityAlias = 'alias:<alias>'

const entityDescriptors = {
    'user': {
        'id': 'Username',
        'fullname': 'Full name',
        'email': 'E-Mail address',
        'groups': (o, v) => v && ['Groups', v.join(' ')],
        'autoshare': (o, v) => v && ['Auto share', v.join(' ')],
        'admin': (o, v) => ['Is administrator', v ? 'yes' : 'no']
    },
    'node': {
        'id': 'Node name',
        'address': 'Address',
        'online': (o, v) => ['State', v ? 'ONLINE' : 'OFFLINE'],
        'since': 'Since',
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
        'continueJob': 'Continued job',
        'description': 'Title',
        'user': 'Owner',
        'groups': (o, v) => v && ['Groups', v.join(' ')],
        'error': (o, v) => v && ['Error', '"' + v + '"'],
        'provisioning': 'Provisioning',
        'resources': 'Resources',
        'utilComp': (o, v) => v && ['Util. GPU', Math.round(v * 100.0) + ' %'],
        'utilMem':  (o, v) => v && ['Util. memory',  Math.round(v * 100.0) + ' %'],
        'state': (o, v) => ['State', jobStateNames[v] + (v == jobStates.WAITING ? ' (position ' + o.schedulePosition + ')' : '')],
        'processes': (o, v) => v && [
            'Processes', 
            '\n' + v.map(p => '  [' + p.groupIndex + ', ' + p.processIndex + ']: Status code: ' + p.status + (p.result ? (' - ' + p.result) : '')).join('\n')
        ],
        'stateChanges': (o, v) => v && [
            'State changes',
            '\n' + v.map(sc => '  ' + jobStateNames[sc.state] + ': ' + sc.since + (sc.reason ? (' - ' + sc.reason) : '')).join('\n')
        ]
    },
    'alias': {
        'id': 'Alias',
        'name': 'For'
    },
    'group': {
        'id': 'Name',
        'title': 'Title'
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

function printJobNumberHelp() {
    printLine('"jobNumber": Number of the targeted job')
}

function printPropertyHelp() {
    printLine('Properties are pairs of property-name and value of the form "property=value".')
}

function printUserPropertyHelp() {
    printLine('User properties: "fullname", "email", "password" (prompted if omitted), "admin" ("yes" or "no").')
}

function printNodePropertyHelp() {
    printLine('Node properties: "address" (mandatory), "port", "minPort", "maxPort", "cvd" (CUDA_VISIBLE_DEVICES), "user".')
}

function printAliasPropertyHelp() {
    printLine('alias properties: "name".')
}

function printExample(line) {
    printLine(indent + '$ ' + line)
}

function splitPair(value, separator, ...names) {
    let obj = {}
    let parts = value.split(separator)
    for (let index in parts) {
        obj[names[index]] = parts[index]
    }
    return obj
}

function parseEntity(entity, indexAllowed) {
    let pair = splitPair(entity, ':', 'type', 'id', 'index')
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
                assignment.value = assignment.value.split(',').filter(x => String(x).length !== 0)
            } else if (assignment.property == 'admin') {
                assignment.value = assignment.value === 'yes' || assignment.value === 'y' || assignment.value === 'true'
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

function _runCommand(args, exitOnError) {
    let file = args.shift()
    let options = { encoding: 'utf8' }
    if (!exitOnError) {
        options.stdio = ['pipe', 'pipe', 'ignore']
    }
    try {
        return execFileSync(file, args, options).trim()
    } catch (err) {
        if (!exitOnError) {
            return
        }
        var message = err.message.includes('ENOENT') ? 'Not found' : err.message
        fail('Problem executing "' + file + '": ' + message)
    }
}

function tryCommand() {
    return _runCommand(Array.prototype.slice.call(arguments), false)
}

function runCommand() {
    return _runCommand(Array.prototype.slice.call(arguments), true)
}

function showLog(jobNumber) {
    let logPath = 'jobs/' + jobNumber + '/log'
    callPit('get', logPath, (code, res) => {
        evaluateResponse(code)
        res.on('data', chunk => {
            process.stdout.write(chunk)
        })
    }, { asStream: true })
}

function printJobGroups(groups, asDate) {
    let fixed = 6 + 3 + (asDate ? 24 : 12) + 3 + 3 + 10 + 40 + 7
    let rest = process.stdout.columns
    if (rest && rest >= fixed) {
        rest = rest - fixed
    } else {
        rest = 30
    }
    writeFragment('JOB', 6, true, ' ')
    writeFragment('S', 3, true, ' ')
    writeFragment(asDate ? 'DATE' : 'SINCE', asDate ? 24 : 12, false, ' ')
    writeFragment('UC%', 3, true, ' ')
    writeFragment('UM%', 3, true, ' ')
    writeFragment('USER', 10, false, ' ')
    writeFragment('TITLE', 40, false, ' ')
    writeFragment('RESOURCE', rest, false, '\n')

    let printJobs = (jobs, caption) => {
        if (jobs.length > 0) {
            if (caption) {
                console.log(caption + ':')
            }
            for(let job of jobs) {
                writeFragment(job.id, 6, true, ' ')
                writeFragment(jobStateNames[job.state], 3, true, ' ')
                writeFragment(asDate ? job.date : formatDuration(job.since), asDate ? 24 : 12, false, ' ')
                writeFragment(Math.round(job.utilComp * 100.0), 3, true, ' ')
                writeFragment(Math.round(job.utilMem * 100.0), 3, true, ' ')
                writeFragment(job.user, 10, false, ' ')
                writeFragment(job.description, 40, false, ' ')
                writeFragment(job.resources, rest, false, '\n')
            }
        }
    }
    for(let group of groups) {
        printJobs(group.jobs, group.caption)
    }
}

function getEntityPath (entitySpec) {
    entity = parseEntity(entitySpec)
    if (entity.type == 'home') {
        return 'users/~'
    }
    if (entity.type == 'group' || entity.type == 'user' || entity.type == 'job') {
        return '' + entity.plural + '/' + entity.id
    }
    if (entity.type == 'shared') {
        return 'shared'
    }
    if (entitySpec.match(/^[0-9]+$/)) {
        return getEntityPath('job:' + entitySpec);
    }
    fail('Unsupported entity type "' + entity.type + '"')
}

function getResourcePath (remotePath) {
    return remotePath ? (remotePath.startsWith('/') ? remotePath.slice(1) : remotePath) : ''
}

function createProgressBar (caption, offset, size) {
    let bar = new ProgressBar('  ' + caption + ' [:bar] :percent :speed :etas', {
        complete: '=',
        incomplete: ' ',
        width: 40,
        total: size
    })
    bar.tick(offset)
    let origTick = bar.tick
    let intervalStart = Date.now()
    let intervalTicks = 0
    let pastTicks = [{time: intervalStart, ticks: 0}]
    let speed = ''
    bar.tick = function(ticks) {
        let now = Date.now()
        intervalTicks += ticks
        if (now - intervalStart > 100) {
            pastTicks.push({time: intervalStart, ticks: intervalTicks})
            intervalStart = now
            intervalTicks = 0
            pastTicks = pastTicks.reverse().slice(0, 10).reverse()
            let transfer = pastTicks.map(t => t.ticks).reduce((t, v) => t + v, 0)
            let timeDiff = (now - pastTicks[0].time) / 1000
            speed = filesize(transfer / timeDiff, {round: 0}) + '/s'
        }
        origTick.apply(bar, [ticks, { speed: speed }])
    }
    return bar
}

function copyContent (entity, remotePath, localPath, options) {
    options = options || {}
    let entityPath = getEntityPath(entity)
    let resource = getResourcePath(remotePath)
    callPit('get', entityPath + '/simplefs/stats/' + resource, (code, stats) => {
        evaluateResponse(code)
        if (stats.isFile) {
            if (localPath) {
                let offset = 0
                if (fs.existsSync(localPath)) {
                    let localStats = fs.statSync(localPath)
                    if (localStats.isDirectory()) {
                        let rname = remotePath.substring(remotePath.lastIndexOf('/') + 1)
                        if (rname.length > 0) {
                            localPath = path.join(localPath, rname)
                        } else {
                            fail('Cannot construct target filename.')
                        }
                    } else if (localStats.isFile()) {
                        if (options.force) {
                            console.error('Target file existing: Re-downloading...')
                        } else if (localStats.size >= stats.size) {
                            fail('Local file already existing. Remove it or use force option to overwrite.')
                        } else if (options.continue) {
                            console.error('Local file already existing and smaller than remote file: Continuing download...')
                            offset = localStats.size
                        } else {
                            let answer = readlineSync.question('Remote file larger than local one. Continue interrupted download (yN)? ', {
                                trueValue: ['y', 'yes']
                            })
                            if (answer === true) {
                                offset = localStats.size
                            } else {
                                fail('Aborted')
                            }
                        }
                    } else {
                        fail('Target path is neither a directory nor a file.')
                    }
                } else {
                    let dirname = path.dirname(localPath)
                    if (fs.existsSync(dirname)) {
                        if (!fs.statSync(dirname).isDirectory()) {
                            fail('Specified target directory is not a directory.')
                        }
                    } else {
                        fail('Target directory not existing.')
                    }
                }
                callPit('get', entityPath + '/simplefs/content/' + resource, (code, res) => {
                    evaluateResponse(code)
                    let bar = createProgressBar('downloading', offset, stats.size)
                    res.on('data', buf => bar.tick(buf.length))
                    let target = fs.createWriteStream(localPath, {flags: offset >  0 ? 'a' : 'w'})
                    res.pipe(target)
                }, {
                    asStream: true,
                    headers: { 'Range': 'bytes=' + offset + '-' }
                })
            } else {
                callPit('get', entityPath + '/simplefs/content/' + resource, (code, res) => {
                    evaluateResponse(code)
                    res.pipe(process.stdout)
                }, { asStream: true })
            }
        } else {
            fail('Command only supports file transfers.')
        }
    })
}

function toWebSocketUrl(httpurl) {
    let endpoint = url.parse(httpurl)
    if (endpoint.protocol == 'https:') {
        endpoint.protocol = 'wss'
    } else {
        endpoint.protocol = 'ws'
    }
    return url.format(endpoint)
}

program
    .version('0.0.1')
    .option('-d, --debug', 'shows JSON messages sent from and to server', () => debugHttp = true)

program
    .command('add <entity> [properties...]')
    .description('adds an entity to the system')
    .on('--help', function() {
        printIntro()
        printExample('pit add user:paul email=paul@x.y password=secret')
        printExample('pit add node:machine1 endpoint=192.168.2.2 password=secret')
        printExample('pit add alias:gtx1070 name="GeForce GTX 1070"')
        printExample('pit add group:students title="Students of machine learning department"')
        printLine()
        printEntityHelp(entityUser, entityNode, entityAlias, entityGroup)
        printPropertyHelp()
        printUserPropertyHelp()
        printNodePropertyHelp()
        printAliasPropertyHelp()
    })
    .action(function(entity, properties) {
        entity = parseEntity(entity)
        if(entity.type == 'user' || entity.type == 'node' || entity.type == 'alias' || entity.type == 'group') {
            let obj = parseEntityProperties(entity, properties)
            if (entity.type == 'user') {
                obj = promptUserInfo(obj)
            } else if (entity.type == 'node') {
                obj = promptNodeInfo(obj)
            } else if (entity.type == 'alias') {
                obj = promptAliasInfo(obj)
            } else {
                obj = promptGroupInfo(obj)
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
        printExample('pit remove user:anna')
        printExample('pit remove node:machine1')
        printExample('pit remove job:123')
        printExample('pit remove alias:gtx1070')
        printExample('pit remove group:students')
        printLine()
        printEntityHelp(entityUser, entityNode, entityJob, entityAlias, entityGroup)
    })
    .action(function(entity) {
        entity = parseEntity(entity)
        if(entity.type == 'user' || entity.type == 'node' || entity.type == 'job' || entity.type == 'alias' || entity.type == 'group') {
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
        printExample('pit set alias:gtx1070 name="GeForce GTX 1070"')
        printExample('pit set group:students title="Different title"')
        printLine()
        printEntityHelp(entityUser, entityNode, entityAlias, entityGroup, entityJob)
        printPropertyHelp()
        printUserPropertyHelp()
        printNodePropertyHelp()
        printAliasPropertyHelp()
    })
    .action(function(entity, assignments) {
        entity = parseEntity(entity)
        if(entity.type == 'user' || entity.type == 'alias' || entity.type == 'group') {
            let obj = parseEntityProperties(entity, assignments)
            if (entity.type == 'user' && !obj.verification) {
                obj.verification = getUserPassword()
            }
            callPit('post', entity.plural + '/' + entity.id, obj, evaluateResponse)
        } else {
            fail('Unsupported entity type "' + entity.type + '"')
        }
    })

program
    .command('passwd [username]')
    .description('set new password')
    .on('--help', function() {
        printIntro()
        printExample('pit passwd')
        printExample('pit passwd paul')
        printLine()
        printLine('"username" is the name of the user, whose password should be changed. If omitted, the user\'s own password should be changed.')
    })
    .action(function(username) {
        username = username || '~'
        let obj = {}
        obj.verification = readlineSync.question('Own password for verification: ', { hideEchoBack: true })
        obj.password = readlineSync.questionNewPassword('New password: ')
        callPit('post', 'users/' + username, obj, evaluateResponse)
    })

program
    .command('get <entity> <property>')
    .description('gets a property of an entity')
    .on('--help', function() {
        printIntro()
        printExample('pit get user:anna email')
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
    .command('show <entity> [params...]')
    .description('shows info about an entity')
    .on('--help', function() {
        printIntro()
        printExample('pit show me')
        printExample('pit show users')
        printExample('pit show groups')
        printExample('pit show nodes')
        printExample('pit show aliases')
        printExample('pit show jobs')
        printExample('pit show jobs user=jill')
        printExample('pit show jobs since=4/2010 asc=date title="%test%"')
        printExample('pit show user:paul')
        printExample('pit show node:machine1')
        printExample('pit show job:235')
        printExample('pit show alias:gtx1070')
        printExample('pit show group:students')
        printLine()
        printEntityHelp('me', 'users', 'groups', 'nodes', 'jobs', 'aliases', entityUser, entityNode, entityJob, entityAlias, entityGroup)
        printLine()
        printLine('For "show jobs" the following query parameters (combined by AND) are supported:')
        printLine('  since=<date value> - shows jobs with a state change date past the provided date')
        printLine('  till=<date value>  - shows jobs with a state change date before the provided date')
        printLine('  user=<username>    - shows jobs owned by the provided user')
        printLine('  title=<wildcard>   - shows jobs whose titles match the provided wildcard')
        printLine('  asc=<field>        - orders jobs ascending by provided field (date|user|title|state)')
        printLine('  desc=<field>       - orders jobs descending by provided field (date|user|title|state)')
        printLine('  limit=<number>     - shows first N results')
        printLine('  offset=<number>    - shows jobs beginning with N-th result')
    })
    .action(function(entity, params, options) {
        if(entity === 'users' || entity === 'groups' || entity === 'nodes' || entity === 'aliases') {
            callPit('get', entity, function(code, body) {
                if (code == 200) {
                    body.forEach(obj => console.log(obj))
                } else {
                    evaluateResponse(code, body)
                }
            })
        } else if(entity === 'jobs') {
            let obj = parseEntityProperties(entity, params)
            let query = []
            for(let param of Object.keys(obj)) {
                query.push(encodeURI(param) + '=' + encodeURI(obj[param]))
            }
            query = query.length > 0 ? '?' + query.join('&') : ''
            callPit('get', entity + query, function(code, body) {
                if (code == 200) {
                    printJobGroups([{ jobs: body }], true)
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
        printExample('pit add-group user:anna students')
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
        printLine()
        printJobNumberHelp()
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
    .option('-d, --direct <commands>', 'directly executes provided commands through bash instead of loading .compute file')
    .option('-l, --log', 'waits for and prints job\'s log output')
    .on('--help', function() {
        printIntro()
        printExample('pit run "My task" 2:[8:gtx1070]')
        printExample('pit run "My command" [] -d \'hostname; env\'')
        printLine()
        printLine('"title" is a short text that will later help identifying the job and its purpose.')
        printLine('"clusterRequest" is an expression to specify resources this job requires from the cluster.')
        printLine('It\'s a comma separated list of "process requests".')
        printLine('Each "process request" specifies the number of process instances and (divided by colon and in braces) which resources to allocate for one process instances (on one node).')
        printLine('The first example will allocate 2 process instances. For each process, 8 "gtx1070" resources will get allocated.')
        printLine('You can also provide a "' + REQUEST_FILE + '" file with the same content in your project root as default value.')
    })
    .action(function(title, clusterRequest, options) {
        var tracking = tryCommand('git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}') || 'origin/master'
        var ob = tracking.split('/')
        if (ob.length != 2) {
            fail('Problem getting tracked git remote and branch')
        }
        var origin = ob[0]
        var branch = ob[1]
        var hash = tryCommand('git', 'rev-parse', tracking)
        if (!hash) {
            fail('Problem getting remote branch "' + tracking + '"')
        }
        var originUrl = runCommand('git', 'remote', 'get-url', '--push', origin)
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
        if (title.length > 40) {
            fail('Job title too long (20 characters max)')
        }
        callPit('post', 'jobs', {
            origin: originUrl,
            hash: hash,
            diff: diff,
            clusterRequest: clusterRequest,
            description: title,
            private: options.private,
            continueJob: options.continue,
            script: options.direct
        }, (code, body) => {
            if (code == 200) {
                console.log('Job number: ' + body.id)
                console.log('Remote:     ' + origin + ' <' + originUrl.replace(/\/\/.*\@/g, '//') + '>')
                console.log('Hash:       ' + hash)
                console.log('Diff LoC:   ' + diff.split('\n').length)
                console.log('Resources:  "' + clusterRequest + '"')
                if (options.log) {
                    console.log()
                    showLog(body.id)
                }
            } else {
                evaluateResponse(code, body)
            }
        })
    })

program
    .command('log <jobNumber>')
    .description('show job\'s log')
    .on('--help', function() {
        printIntro()
        printExample('pit log 1234')
        printLine()
        printJobNumberHelp()
    })
    .action(jobNumber => showLog(jobNumber))

program
    .command('exec <jobNumber> -- ...')
    .usage('[options] <jobNumber> -- cmd arg1 ... argN')
    .description('execute command on a job\'s worker')
    .option('-w, --worker <workerIndex>', 'index of the target worker (defaults to 0)')
    .on('--help', function() {
        printIntro()
        printExample('pit exec 1234 -- bash')
        printExample('pit exec 1234 -- ls -la /')
        printExample('pit exec -w 1 1234 -- cat /data/rw/pit/src/.compute >1234.compute')
        printLine()
        printJobNumberHelp()
    })
    .action((jobNumber, options) => {
        let instance = '' + (options.worker || 0)
        getConnectionSettings(connection => {
            let endpoint = toWebSocketUrl(connection.url)
            let stdin  = process.stdin
            let stdout = process.stdout
            let stderr = process.stderr

            let context = JSON.stringify({
                command: shellCommand,
                environment: {
                    TERM: process.env.TERM
                },
                interactive: !!stdin.setRawMode,
                width: stdout.columns,
                height: stdout.rows
            })
            let ws = new WebSocket(endpoint + 'jobs/' + jobNumber + '/instances/' + instance + '/exec?context=' + encodeURIComponent(context), {
                headers: { 'X-Auth-Token': connection.token },
                ca: connection.ca
            })


            if (stdin.setRawMode) {
                stdin.setRawMode(true)
                stdin.resume()
            }
            let buffers = []
            stdin.on('data', data => {
                if ( data === '\u0003' ) {
                    process.exit()
                }
                let buffer = Buffer.concat([new Buffer([1]), data])
                if (buffers) {
                    buffers.push(buffer)
                } else {
                    ws.send(buffer)
                }
            })

            stdout.on('resize', () => {
                let data = JSON.stringify({
                    "command": "window-resize",
                    "args": {
                        "width": "" + stdout.columns,
                        "height": "" + stdout.rows
                    }
                })
                ws.send(Buffer.concat([new Buffer([0]), Buffer.from(data)]))
            })

            ws.on('open', () => {
                for (let buffer of buffers) {
                    ws.send(buffer)
                }
                buffers = undefined
            })
            ws.on('message', data => {
                if (data[0] == 1) {
                    stdout.write(data.slice(1))
                } else if (data[0] == 2) {
                    stderr.write(data.slice(1))
                }
            })
            ws.on('error', err => fail('Problem opening connection to pit: ' + err))
            ws.on('close', () => process.exit(0))
        })
    })

program
    .command('forward <jobNumber> [ports...]')
    .description('forward ports of a job\'s worker to localhost')
    .option('-w, --worker <workerIndex>', 'index of the target worker (defaults to 0)')
    .on('--help', function() {
        printIntro()
        printExample('pit forward 1234 8080:80 7022:22')
        printExample('pit forward 1234 8080')
        printLine()
        printJobNumberHelp()
        printLine('"ports": All the ports to forward. Each port has to be provided either as one number (local and remote port being the same) or as a colon-separated pair where the first one is the local and the second one the remote counter-part.')
    })
    .action((jobNumber, ports, options) => {
        let instance = '' + (options.worker || 0)
        let portPairs = {}
        for (let port of ports) {
            let [localPort, remotePort] = port.split(':').map(x => Number(x))
            remotePort = remotePort || localPort
            if (!localPort) {
                fail('Wrong port pair format')
            }
            portPairs[localPort] = remotePort
        }
        getConnectionSettings(connection => {
            let endpoint = toWebSocketUrl(connection.url)
            let ws = websocket(endpoint + 'jobs/' + jobNumber + '/instances/' + instance + '/forward', {
                headers: { 'X-Auth-Token': connection.token },
                ca: connection.ca
            })
            let mp = multiplex()
            mp.pipe(ws)
            ws.pipe(mp)
            let idc = 0
            let onConnection = socket => {
                let remotePort = portPairs[socket.localPort]
                let id = idc++
                let stream = mp.createStream(id + '-' + remotePort)
                socket.pipe(stream)
                stream.pipe(socket)
                stream.on('error', err => { console.error('Remote', err.message || 'problem'); socket.end() })
            }
            for (let localPort of Object.keys(portPairs)) {
                let remotePort = portPairs[localPort]
                console.log('Forwarding port ' + remotePort + ' of worker ' + instance + ' to port ' + localPort + ' on localhost...')
                let server = net.createServer(onConnection)
                server.listen(localPort, 'localhost')
            }
            console.log('Hit Ctrl-C to stop forwarding.')
            mp.on('error', err => fail('Problem with remote end - Closing'))
            ws.on('error', err => fail('Problem opening connection to pit: ' + err))
        })
    })

program
    .command('ls <entity> [remotePath]')
    .description('lists contents within a job directory')
    .on('--help', function() {
        printIntro()
        printExample('pit ls job:1234 sub-dir')
        printExample('pit ls home')
        printExample('pit ls group:students path/to/some/group/data')
        printExample('pit ls shared path/to/some/shared/data')
        printLine()
        printLine('"entity" is the entity whose data directory should be accessed')
        printEntityHelp('home', entityUser, entityJob, entityGroup, 'shared')
        printLine('"remotePath" is the path to list within the remote data directory.')
    })
    .action((entity, remotePath) => {
        let entityPath = getEntityPath(entity)
        let resource = getResourcePath(remotePath)
        callPit('get', entityPath + '/simplefs/stats/' + resource, (code, stats) => {
            evaluateResponse(code)
            if (stats.isFile) {
                console.log('F ' + resource)
            } else {
                callPit('get', entityPath + '/simplefs/content/' + resource, (code, contents) => {
                    evaluateResponse(code)
                    for(let dir of contents.dirs) {
                        console.log('D ' + dir)
                    }
                    for(let file of contents.files) {
                        console.log('F ' + file)
                    }
                })
            }
        })
    })

program
    .command('pull <entity> <remotePath> [localPath]')
    .alias('cp')
    .option('-f, --force', 'will overwrite existing target file if existing - always starting download from scratch')
    .option('-c, --continue', 'will try to continue interrupted download - starting from scratch, if target is not existing')
    .description('copies contents from an entity\'s file to a local file or stdout')
    .on('--help', function() {
        printIntro()
        printExample('pit pull job:1234 keep/checkpoint-0001.bin ./checkpoint.bin')
        printExample('pit pull home data/corpus.data ./corpus.data')
        printLine()
        printLine('"entity" is the entity whose data directory should be accessed')
        printEntityHelp('home', entityUser, entityJob, entityGroup, 'shared')
        printLine('"remotePath" is the source path within the remote data directory.')
        printLine('"localPath" is the destination path within the local filesystem. If omitted, data will be written to stdout.')
    })
    .action((entity, remotePath, localPath, options) => copyContent(entity, remotePath, localPath, options))

program
    .command('cat <entity> <remotePath>')
    .description('copies contents from an entity\'s directory to stdout')
    .on('--help', function() {
        printIntro()
        printExample('pit cat job:1234 keep/results.txt')
        printExample('pit cat home data/some.txt')
        printLine()
        printLine('"entity" is the entity whose data directory should be accessed')
        printEntityHelp('home', entityUser, entityJob, entityGroup, 'shared')
        printLine('"remotePath" is the source path within the remote data directory.')
    })
    .action((entity, remotePath) => copyContent(entity, remotePath))

program
    .command('push <entity> <remotePath> [localPath]')
    .option('-f, --force', 'will overwrite existing target file if existing - always starting upload from scratch')
    .option('-c, --continue', 'will try to continue interrupted upload - starting from scratch, if target is not existing')
    .description('copies contents from stdin or local file system to a file in an entity\'s tree')
    .on('--help', function() {
        printIntro()
        printExample('pit push group:students some/dir/data.bin ./data.bin')
        printExample('generate-some-data.py | pit push home keeping/some.data')
        printLine()
        printLine('"entity" is the entity whose data directory should be targeted')
        printEntityHelp('home', entityUser, entityGroup)
        printLine('"remotePath" is the target path within the remote entity\'s directory.')
        printLine('"localPath" is the path to a source file within the local filesystem. If omitted, data will be read from stdin.')
    })
    .action((entity, remotePath, localPath, options) => {
        let entityPath = getEntityPath(entity)
        let resource = getResourcePath(remotePath)
        let localStats
        let size = 0
        if (localPath) {
            if (fs.existsSync(localPath)) {
                localStats = fs.statSync(localPath)
                size = localStats.size
            } else {
                fail('Source file not found.')
            }
        }
        let transferContent = (offset) => {
            let targetPath = entityPath + '/simplefs/content/' + resource
            if (localStats) {
                let stream = fs.createReadStream(localPath, { start: offset })
                let bar = createProgressBar('uploading', offset, size)
                stream.on('data', buf => bar.tick(buf.length))
                callPit('put', targetPath, stream, (code, res) => {
                    evaluateResponse(code)
                }, {
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'Content-Offset': offset
                    }
                })
            } else {
                callPit('put', targetPath, process.stdin, (code, res) => {
                    evaluateResponse(code)
                }, { headers: { 'Content-Type': 'application/octet-stream' } })
            }
        }
        let statsPath = entityPath + '/simplefs/stats/' + resource
        callPit('get', statsPath, (code, stats) => {
            if (code === 404) {
                console.error('Remote file not existing - creating...')
                callPit('put', statsPath, { type: 'file' }, (code, res) => {
                    evaluateResponse(code)
                    transferContent(0)
                })
            } else {
                evaluateResponse(code)
                if (stats.isFile) {
                    if (stats.size < size) {
                        if (options.continue) {
                            console.error('Remote file smaller than local one - continuing upload...')
                            transferContent(stats.size)
                        } else {
                            if (options.force) {
                                console.error('Remote file existing - re-uploading...')
                                transferContent(0)
                            } else {
                                let answer = readlineSync.question('Remote file smaller than local one. Continue interrupted upload (yN)? ', {
                                    trueValue: ['y', 'yes']
                                })
                                if (answer === true) {
                                    transferContent(stats.size)
                                } else {
                                    fail('Aborted')
                                }
                            }
                        }
                    } else {
                        if (options.force) {
                            console.error('Remote file is of same size or larger than local one - re-uploading...')
                            transferContent(0)
                        } else {
                            fail('Remote file is of same size or larger than local one.')
                        }
                    }
                } else {
                    fail('Target path is existing, but not a file.')
                }
            }
        })
    })

program
    .command('mkdir <entity> <remotePath>')
    .description('creates an entity directory')
    .on('--help', function() {
        printIntro()
        printExample('pit mkdir group:students some/dir')
        printLine()
        printLine('"entity" is the entity whose data directory should be targeted')
        printEntityHelp('home', entityUser, entityGroup)
        printLine('"remotePath" is the target path within the remote entity\'s tree.')
    })
    .action((entity, remotePath) => {
        let entityPath = getEntityPath(entity)
        let resource = getResourcePath(remotePath)
        callPit('put', entityPath + '/simplefs/stats/' + resource, { type: 'directory' }, (code) => {
            evaluateResponse(code)
        })
    })

program
    .command('delete <entity> <remotePath>')
    .description('deletes a file or directory within an entity\'s tree')
    .on('--help', function() {
        printIntro()
        printExample('pit delete group:students some/dir')
        printExample('pit delete home some/file.txt')
        printLine()
        printLine('"entity" is the entity whose data directory should be targeted')
        printEntityHelp('home', entityUser, entityGroup)
        printLine('"remotePath" is the target path within the remote entity\'s tree.')
    })
    .action((entity, remotePath) => {
        let entityPath = getEntityPath(entity)
        let resource = getResourcePath(remotePath)
        callPit('delete', entityPath + '/simplefs/stats/' + resource, (code) => {
            evaluateResponse(code)
        })
    })

program
    .command('mount <entity> [mountpoint]')
    .description('mounts the data directory of an entity to a local mountpoint')
    .option('--shell', 'starts a shell in the mounted directory. The mount will be automatically unmounted upon shell exit.')
    .on('--help', function() {
        printIntro()
        printExample('pit mount home')
        printExample('pit mount user:anna ~/annahome')
        printExample('pit mount --shell job:1234')
        printExample('pit mount group:students ./students')
        printExample('pit mount shared ./shared')
        printLine()
        printLine('"entity" is the entity whose data directory will be mounted')
        printEntityHelp('home', entityUser, entityJob, entityGroup, 'shared')
        printLine('"mountpoint" is the directory where the data directory will be mounted onto. Has to be empty. If omitted, a temporary directory will be used as mountpoint and automatically deleted on unmounting.')
        printLine('Home and group directories are write-enabled, all others are read-only.')
    })
    .action((entity, mountpoint, options) => {
        let httpfs
        try {
            httpfs = require('./httpfs.js')
        } catch (ex) {
            fail(
                'For mounting, package "fuse" has to be installed.\n' +
                'Most likely it has been skipped due to missing dependencies.\n' +
                'Please consult the following page for system specific requirements:\n' +
                '\thttps://github.com/mafintosh/fuse-bindings#requirements\n' +
                'Once fulfilled, you can either re-install snakepit-client or\n' +
                'call again "npm install" within its project root.'
            )
        }
        getConnectionSettings(connection => {
            if (mountpoint) {
                mountpoint = { name: mountpoint, removeCallback: () => {} }
            } else {
                mountpoint = tmp.dirSync()
            }
            let mountOptions = { 
                headers: { 'X-Auth-Token': connection.token },
                cache: true,
                blocksize: 10 * 1024 * 1024
            }
            if (connection.ca) {
                mountOptions.certificate = connection.ca
            }
            httpfs.mount(
                connection.url + getEntityPath(entity) + '/fs',
                mountpoint.name, 
                mountOptions, 
                (err, mount) => {
                    if (err) { 
                        fail(err) 
                    }
                    let unmount = () => mount.unmount(err => {
                        if (err) {
                            console.error('problem unmounting filesystem:', err)
                        } else {
                            mountpoint.removeCallback()
                        }
                    })
                    if (options.shell) {
                        console.log('secondary shell: call "exit" to end and unmount')
                        let sh = spawn(process.env.SHELL || 'bash', ['-i'], { stdio: 'inherit', cwd: mountpoint.name })
                        sh.on('close', unmount)
                    } else {
                        console.log('press Ctrl-C to unmount')
                        globalunmount = unmount
                    }
                }
            )
        })
    })

program
    .command('status')
    .description('prints a job status report')
    .on('--help', function() {
        printIntro()
        printExample('pit status')
    })
    .action(function(options) {
        let updateStatus = () => {
            callPit('get', 'jobs/status', function(code, jobGroups) {
                if (code == 200) {
                    printJobGroups([
                        { jobs: jobGroups.running, caption: 'Running' },
                        { jobs: jobGroups.waiting, caption: 'Waiting' },
                        { jobs: jobGroups.done,    caption: 'Done'    }
                    ])
                } else {
                    evaluateResponse(code, jobGroups)
                }
            })
        }
        updateStatus()
    })

program
    .command('*')
    .action(function() {
        fail("unknown command");
    })

var argv = process.argv
var shellCommand
var dashSplitter = argv.indexOf('--')
if (dashSplitter >= 0) {
    shellCommand = argv.slice(dashSplitter + 1)
    argv = argv.slice(0, dashSplitter)
}

program.parse(argv)

if (!argv.slice(2).length) {
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

function unmount() {
    if (globalunmount) {
        console.log('\runmounting...')
        globalunmount()
        globalunmount = null
    }
}

process.on('SIGINT', () => {
    unmount()
    process.exit(0)
})

process.on('exit', () => {
    unmount()
})

