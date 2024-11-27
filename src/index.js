'use strict'

const axios = require('axios')
const { XrplClient } = require('xrpl-client')
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
		const ClientConnection = [process.env.APP_XRPL, 'wss://xrplcluster.com', 'wss://xrpl.link', 'wss://s2.ripple.com']

		let socket
		let socketFX
		let ping
		let oracle
		let memes = {}
		let fx

		Object.assign(this, {
		    async run() {
				log('runnig')
				this.connect()
				this.forex()
				this.server()
				oracle = new filter(socket)
				const self = this

				// adjust the interval and record timeout
				oracle.run(250, 60000)

				oracle.on('oracle', (data) => {
					self.route('oracle', data)
					// log(data)
					let logData = {}
					Object.entries(data).forEach(([key, value]) => {
						if (key !== 'STATS') {
							logData[key] = {
								Price: value.Price,
								Results: value.Results,
								LastRecord: value.LastRecord
							}
						}
                    })
					logData['STATS'] = data['STATS']
					// log(logData)
				})

				oracle.on('dex', (data) => {
					self.route('dex', data)
					// log(data)
				})
			},
			connect() {
				if (ping !== undefined) {
                    clearInterval(ping)
                }
				const self = this
				socket = new WebSocket(process.env.APP_SOCKET)
				socket.onopen = async function (message) {
                    await self.waitForOpenConnection(socket)
                    socket.send(JSON.stringify({
                        op: 'subscribe',
                        channel: 'threexrpl'
                    }))
                    ping = setInterval(function() {
                        socket.send(JSON.stringify({ op: 'ping' }))
                    }, 5000)
                    console.log('socket_three trade sockets connected! :)')
                }
				socket.onclose = function (event) {
					// need better reconnect here
					console.log('socket closed', event)
					setTimeout(() => {
						if ( oracle !== undefined) {
							oracle.reset()
						}
						self.connect()
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
			},
			forex() {
				const self = this
				socketFX = new WebSocket('wss://three-forex.panicbot.xyz')
				socketFX.onmessage = function (message) {
					const data = JSON.parse(message.data)
					if ('rates' in data) {
						self.fx = data.rates
						// log(data.rates)
					}
				}
				socketFX.onclose = function (event) {
					// need better reconnect here
					setTimeout(() => {
						self.forex()
					}, 10_000)
				}
			}
		})
	}
}

dotenv.config()
log('starting..')
const main = new service()
main.run()
// main.cancel()


