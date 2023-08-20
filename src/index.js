'use strict'

const WebSocket = require('ws')
const WebSocketServer = require('ws').Server
const decimal = require('decimal.js')
const dotenv = require('dotenv')
const debug = require('debug')
const log = debug('apps:oracle')
const filter = require('./filter.js')

class service  {
	constructor() {
		const wss = new WebSocketServer({ port: process.env.APP_PORT })

		let socket
		let ping

		Object.assign(this, {
		    async run() {
				log('runnig')
				this.connect()
				this.server()
				const oracle = new filter(socket)
				const self = this

				// adjust the interval and record timeout
				oracle.run(250, 60000)

				oracle.on('oracle', (data) => {
					self.route('oracle', data)
					let list = []
					let logData = {}
					Object.entries(data).forEach(([key, value]) => {
						if (key !== 'STATS') {
							list.push(value)
							logData[key] = {
								Price: value.Price,
								Results: value.Results,
								LastRecord: value.LastRecord,
							}
						}
                    })
					list = this.sortData(list)
					logData.STATS = data.STATS
					log(logData)
				})
			},
			sortData(data) {
				return data.sort(function(a, b) {
					return a.token > b.token
				})
			},
			connect() {
				if (ping !== undefined) {
                    clearInterval(ping)
                }
				const self = this
				socket = new WebSocket('ws://three-dev.panicbot.xyz:3131')
				socket.onopen = async function (message) {
                    await self.waitForOpenConnection(socket)
                    socket.send(JSON.stringify({
                        op: 'subscribe',
                        channel: 'public'
                    }))
                    ping = setInterval(function() {
                        socket.send(JSON.stringify({ op: 'ping' }))
                    }, 5000)
                    console.log('socket_three trade sockets connected! :)')
                }
				socket.onclose = function (event) {
					// need better reconnect here
					setTimeout(async () => {
						await self.waitForOpenConnection(socket)
					}, 10000)
				}
			},
			async waitForOpenConnection(socket) {
                return new Promise((resolve, reject) => {
                    const maxNumberOfAttempts = 10
                    const intervalTime = 200 //ms

                    let currentAttempt = 0
                    const interval = setInterval(() => {
                        if (currentAttempt > maxNumberOfAttempts - 1) {
                            clearInterval(interval)
                            reject(new Error('Maximum number of attempts exceeded'))
                        } else if (socket.readyState == 1) {
                            clearInterval(interval)
                            resolve()
                        }
                        currentAttempt++
                    }, intervalTime)
                })
            },
			server() {
				wss.on('connection', (ws, req) => {
					ws.on('message', (message) => {
						//log(message)
					})
					ws.on('close', () => {
						log('client disconnected')
					})
					ws.on('error', (error) => {
						log('SocketServer error')
						// log(error)
					})
				})
			},
			route(channel, message) {
				const string = '{"' + channel +'": ' + JSON.stringify(message) + '}'
				wss.clients.forEach(function each(client) {
					client.send(string)
				})
			}
		})
	}
}

dotenv.config()
log('starting..')
const main = new service()
main.run()
// main.cancel()


