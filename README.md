# snakepit-client

Client for the snakepit machine learning job scheduler

## N.B.
- You must `git commit` local changes before they can be run on the cluster.

- You must `git branch --set-upstream-to=origin/your_branch` to set the tracking branch correctly.

## Getting Started

- `$ git clone https://github.com/mozilla/snakepit-client`
- `$ cd snakepit-client`
- `snakepit-client$ npm install`
- `snakepit-client$ sudo npm link`

## Getting Connected

You have two options to get connected to your server of interest:

1) If you know your pit's URL, use "pit connect <URL>" to configure the connection.

`pit connect <URL>`

or

2) If your pit admin provided a ".pitconnect.txt" file, place it either in your home directory (as default pit) or the (overruling) project root.

`mv .pitconnect.txt ~/.pitconnect.txt`