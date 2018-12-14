# Snakepit Client

Command-line client for the [snakepit machine learning job scheduler](https://github.com/mozilla/snakepit)

## Installation

This is a preliminary installation guide, as the client is not mature enough for being hosted as NPM package yet.

### Prerequisites

* git
* Node.js (8.00+ is tested)

### Installing

Follow these steps to install the client:
```
$ git clone https://github.com/mozilla/snakepit-client.git
[...]
$ cd snakepit
snakepit$ npm install
[...]
snakepit$ sudo npm link
[...]
snakepit$ pit --help
Usage: pit [options] [command]

Options:
  -V, --version                               output the version number
  -h, --help                                  output usage information

Commands:
  add <entity> [properties...]                adds an entity to the system
  remove|rm <entity>                          removes an entity from the system
  set <entity> <assignments...>               sets properties of an entity
  get <entity> <property>                     gets a property of an entity
  show <entity>                               shows info about an entity
  add-group <entity> <group>                  adds the entity to the access group
  remove-group <entity> <group>               removes the entity from the access group
  stop <jobNumber>                            stops a running job
  run|put [options] <title> [clusterRequest]  enqueues current directory as new job
  log [options] <jobNumber>                   show job's log
  download <jobNumber>                        downloads job directory as .tar.gz archive
  ls <jobNumber> [path]                       lists contents within a job directory
  cp <jobNumber> <jobPath> <fsPath>           copies contents within from job directory to local file system
  mount [options] <entity> [mountpoint]       mounts the data directory of an entity to a local mountpoint
  status                                      prints a job status report
  *
```

### First time use

The administrators of the Snakepit cluster should've provided you a so called `.pitconnect.txt` file.
This file is to be placed either in your home directory or inside a project root (overruling the one in your home directory).

To test your setup, change into that directory and run the following:
```
$ pit status
No user info found. Seems like a new user or first time login from this machine.
Please enter an existing or new username: tilman
Found no user of that name.
Do you want to register this usename (yes|no)? yes
Full name: Tilman Kamp
E-Mail address: ...
New password: ************
Reinput a same one to confirm it: ************
   JOB   S SINCE        UC% UM% USER       TITLE                RESOURCE 
```
If your username had been known already, the client would've asked you for the password 
and registered a token for this (additional) machine.

If all went well, the following command shows your account status:
```
$ pit show me
Username:         tilman
Full name:        Tilman Kamp
E-Mail address:   ...
```

## Running jobs

Running a job is done through the `run` command:
```
$ pit run --help
Usage: run|put [options] <title> [clusterRequest]

enqueues current directory as new job

Options:
  -p, --private               prevents automatic sharing of this job
  -c, --continue <jobNumber>  continues job with provided number by copying its "keep" directory over to the new job
  -d, --direct <commands>     directly executes provided commands through bash instead of loading .compute file
  -l, --log                   waits for and prints job's log output
  -h, --help                  output usage information

    Examples:

    $ pit run "My task" 2:[8:gtx1070]
    $ pit run "My command" [] -d 'hostname; env'

  "title" is a short text that will later help identifying the job and its purpose.
  "clusterRequest" is an expression to specify resources this job requires from the cluster.
  It's a comma separated list of "process requests".
  Each "process request" specifies the number of process instances and (divided by colon and in braces) which resources to allocate for one process instances (on one node).
  The first example will allocate 2 process instances. For each process, 8 "gtx1070" resources will get allocated.
  You can also provide a ".pitrequest.txt" file with the same content in your project root as default value.
```

### Finding and allocating resources (GPUs)

As you can see, we have to specify a so-called cluster-request to allocate a set of GPUs.
But for being able to do so, we first need to know, which resources/GPUs are available in the cluster:
```
$ pit show nodes
n0
n1
$ pit show node:n0
Node name: n0
State:     ONLINE
Resources: 
  0: "GeForce GTX 1070" aka "gtx1070" (cuda 0)
  1: "GeForce GTX 1070" aka "gtx1070" (cuda 1)
```

We found at least one node with 2 "GeForce GTX 1070" GPUs.
So let's allocate both and run a test job on them:
```
$ pit run "First light" [2:gtx1070] -d 'cat /proc/driver/nvidia/gpus/**/*' -l
Job number: 190
Remote:     origin <https://github.com/...>
Hash:       ...
Diff LoC:   0
Resources:  "[2:gtx1070]"

[2018-12-14 17:04:58] [daemon] Pit daemon started
[2018-12-14 17:05:01] [worker 0] Worker 0 started
[2018-12-14 17:05:01] [worker 0] Model: 		 GeForce GTX 1070
[2018-12-14 17:05:01] [worker 0] IRQ:   		 139
[2018-12-14 17:05:01] [worker 0] GPU UUID: 	 ...
[2018-12-14 17:05:01] [worker 0] Video BIOS: 	 86.04.26.00.80
[2018-12-14 17:05:01] [worker 0] Bus Type: 	 PCIe
[2018-12-14 17:05:01] [worker 0] DMA Size: 	 47 bits
[2018-12-14 17:05:01] [worker 0] DMA Mask: 	 0x7fffffffffff
[2018-12-14 17:05:01] [worker 0] Bus Location: 	 0000:01:00.0
[2018-12-14 17:05:01] [worker 0] Device Minor: 	 0
[2018-12-14 17:05:01] [worker 0] Blacklisted:	 No
[2018-12-14 17:05:01] [worker 0] Binary: ""
[2018-12-14 17:05:01] [worker 0] Model: 		 GeForce GTX 1070
[2018-12-14 17:05:01] [worker 0] IRQ:   		 142
[2018-12-14 17:05:01] [worker 0] GPU UUID: 	 ...
[2018-12-14 17:05:01] [worker 0] Video BIOS: 	 86.04.26.00.80
[2018-12-14 17:05:01] [worker 0] Bus Type: 	 PCIe
[2018-12-14 17:05:01] [worker 0] DMA Size: 	 47 bits
[2018-12-14 17:05:01] [worker 0] DMA Mask: 	 0x7fffffffffff
[2018-12-14 17:05:01] [worker 0] Bus Location: 	 0000:02:00.0
[2018-12-14 17:05:01] [worker 0] Device Minor: 	 1
[2018-12-14 17:05:01] [worker 0] Blacklisted:	 No
[2018-12-14 17:05:01] [worker 0] Binary: ""
[2018-12-14 17:05:01] [worker 0] Worker 0 ended with exit code 0
[2018-12-14 17:05:01] [daemon] Worker 0 requested stop. Stopping pit...
```
Both GPUs were allocated for one process.

But what if we want to have two processes allocating one GPU each?
Let's try:
```
$ pit run "Second light" 2:[gtx1070] -d 'cat /proc/driver/nvidia/gpus/**/*' -l
Job number: 191
Remote:     origin <https://github.com/...>
Hash:       ...
Diff LoC:   0
Resources:  "2:[gtx1070]"

[2018-12-14 22:58:27] [daemon] Pit daemon started
[2018-12-14 22:58:28] [worker 0] Worker 0 started
[2018-12-14 22:58:28] [worker 0] Model: 		 GeForce GTX 1070
[2018-12-14 22:58:28] [worker 0] IRQ:   		 139
[2018-12-14 22:58:28] [worker 0] GPU UUID: 	 GPU-9009fe9c-0cca-ea59-631c-14d419efc397
[2018-12-14 22:58:28] [worker 0] Video BIOS: 	 86.04.26.00.80
[2018-12-14 22:58:28] [worker 0] Bus Type: 	 PCIe
[2018-12-14 22:58:28] [worker 0] DMA Size: 	 47 bits
[2018-12-14 22:58:28] [worker 0] DMA Mask: 	 0x7fffffffffff
[2018-12-14 22:58:28] [worker 0] Bus Location: 	 0000:01:00.0
[2018-12-14 22:58:28] [worker 0] Device Minor: 	 0
[2018-12-14 22:58:28] [worker 0] Blacklisted:	 No
[2018-12-14 22:58:28] [worker 0] Binary: ""
[2018-12-14 22:58:28] [worker 0] Worker 0 ended with exit code 0
[2018-12-14 22:58:28] [worker 1] Worker 1 started
[2018-12-14 22:58:28] [worker 1] Model: 		 GeForce GTX 1070
[2018-12-14 22:58:28] [worker 1] IRQ:   		 142
[2018-12-14 22:58:28] [worker 1] GPU UUID: 	 GPU-f5ee1d0f-392c-5999-a708-00eedb04a761
[2018-12-14 22:58:28] [worker 1] Video BIOS: 	 86.04.26.00.80
[2018-12-14 22:58:28] [worker 1] Bus Type: 	 PCIe
[2018-12-14 22:58:28] [worker 1] DMA Size: 	 47 bits
[2018-12-14 22:58:28] [worker 1] DMA Mask: 	 0x7fffffffffff
[2018-12-14 22:58:28] [worker 1] Bus Location: 	 0000:02:00.0
[2018-12-14 22:58:28] [worker 1] Device Minor: 	 1
[2018-12-14 22:58:28] [worker 1] Blacklisted:	 No
[2018-12-14 22:58:28] [worker 1] Binary: ""
[2018-12-14 22:58:28] [worker 1] Worker 1 ended with exit code 0
[2018-12-14 22:58:28] [daemon] Worker 0 requested stop. Stopping pit...
[2018-12-14 22:58:28] [daemon] Worker 1 requested stop. Stopping pit...
```

As you can see, the difference makes the resource allocation format:
While
```
[2:gtx1070]
```
allocates __1__ process with __2__ GPUs, 
```
2:[gtx1070]
```
allocates __2__ process with __1__ GPU each.
The square brackets represent a process and `n:` prefixes are quantifies. No quantifier means "1:".

It's also possible to allocate processes without GPUs and processes with multiple - comma-separated - GPU types:
```
$ pit run "Strange job" 2:[],4:[gtx1070,2:gtx1060] -d 'echo "Strange!"'
```
This example allocates 2 processes without GPUs and 4 processes with 1 gtx1070 and 2 gtx1060 each.

If you specify multiple processes, they can also get allocated on different machines.
It's important to keep in mind that one process cannot be split in half and scheduled to more than one machine. 

### Communicating with other processes

Once you allocated multiple processes for a job, the instances have to be able to communicate with each other.
This can be achived through a set of environment variables that is provided to each process/script-instance:

* `$NUM_GROUPS`: Number of (comma separated) "process-groups". E.g. allocation "2:[],[gtx1060]" represents two process-groups.
* `$NUM_PROCESSES_GROUP<i>`: Number of processes in process-group with index i. E.g. in "2:[],[gtx1060]" the value of `$NUM_PROCESSES_GROUP0` is 2.
* `$HOST_GROUP<i>_PROCESS<j>`: Hostname of process j in process-group i.
* `$GROUP_INDEX`: Group-index of current process.
* `$PROCESS_INDEX`: Process-index of current process within its process-group.

Let's imagine a job with allocation "2:[]".
To let the two processes ping each other, the first process (0) has to execute
```
ping $HOST_GROUP0_PROCESS1
```
and the other (1) has to execute
```
ping $HOST_GROUP0_PROCESS0
```

### Accessing data

There are four different data domains in Snakepit.
Jobs have the same read/write rights as their owning users.
Within your `.compute` script or a direct command you can use the following environment variable to access data:
* Shared data: `$SHARED_DIR` - Files in this directory are read-only for everyone and considered public.
    Only users with direct access to the head-node can change its contents.
* Group data: `$<GROUP-NAME>_GROUP_DIR` - Admins and all members of the given group have read/write access to all contents.
* User data: `$USER_DIR` - Admins and the user itself have read-write access.
* Job data: `$JOB_DIR` and `$SRC_DIR` (where the `.compute` script is running) - Admins, the owning user and group members of groups specified in the "groups" property of the job have read-access. Only the running job is allowed to write data.

## Known limitations

- No integrated support for Git LFS. Work-around: Commit/Push LFS binaries to your remote/origin repository before scheduling a job.
- Problems with binaries. Work-around: Commit/Push binaries to your remote/origin repository before scheduling a job.
- File diffs are only done on tracked files. Work-around: `git add <filename>` before scheduling a job (and removing it afterwards if not to be pushed to repo).

## Help

1. [**IRC**](https://wiki.mozilla.org/IRC) - You can contact us on the `#machinelearning` channel on [Mozilla IRC](https://wiki.mozilla.org/IRC); people there can try to answer/help

2. [**Issues**](https://github.com/mozilla/snakepit-client/issues) - If you think you ran into a serious problem, feel free to open an issue in our repo.
