'use strict'

const EventEmitter = require('events')
const axios = require('axios')
const WebSocket = require('ws')
const WebSocketServer = require('ws').Server
const decimal = require('decimal.js')
const dotenv = require('dotenv')
const debug = require('debug')
const log = debug('apps:oracle')
const filter = require('./filter.js')
const { setTimeout } = require('timers/promises')

class service extends EventEmitter {
	constructor() {
		super()

		const wss = new WebSocketServer({ port: process.env.APP_PORT })

		let timeoutpause
		let openConnectionInterval
		let socket
		let socketFX
		let ping
		let oracle
		let data_copy
		let connected = false
		// let timeout_connected = true

		Object.assign(this, {
			logAppStats() {
				const usage = process.memoryUsage()
				usage.rss = usage.rss / Math.pow(1000, 2)
				usage.heapTotal = usage.heapTotal / Math.pow(1000, 2)
				usage.heapUsed = usage.heapUsed / Math.pow(1000, 2)
				usage.external = usage.external / Math.pow(1000, 2)
				usage.arrayBuffers = usage.arrayBuffers / Math.pow(1000, 2)

				log(`rss: ${usage.rss} MB, total: ${usage.heapTotal} MB, used: ${usage.heapUsed} MB, external: ${usage.external} MB, arrayBuffers: ${usage.arrayBuffers} MB`)
			},
		    async run() {
				log('runnig')
				const self = this
				this.forex()
				this.server()

				this.connect()
				this.newOracle()
				this.eventListeners()
				setInterval(function() {
					self.emit('memstats')
				}, 20_000)
			},
			async newOracle() {
				const self = this
				oracle = new filter(socket)
				// adjust the interval and record timeout
				oracle.run(250, 60000)

				oracle.on('oracle', (data) => {
					//log(data['RLUSD'])
					self.route('oracle', data)
					let logData = {}
					data_copy = data
					Object.entries(data).forEach(([key, value]) => {
						if (key !== 'STATS') {
							logData[key] = {
								Price: value.Price,
								Results: value.Results,
								LastRecord: value.LastRecord
							}
							// connected = true
						}
						else {
							self.route('stats', value)
						}
                    })
				})

				oracle.on('dex', (data) => {
					self.route('dex', data)
				})
			},
			eventListeners() {
				this.addListener('memstats', async () => {
					this.logAppStats()
					log('data size', Object.keys(data_copy).length)
					if (Object.keys(data_copy).length <= 6) {
						connected = false
						log('reconnect no data ---------------->')
						this.emit('kill-process')
					}
				})
				this.addListener('kill-process', async () => {
					process.exit()
				})
				this.addListener('reconnect-websocket', async () => {
					// timeout_connected = true
					await this.pause(5_000)
					log('Reconnecting websocket....')
					clearTimeout(timeoutpause)
					this.connect()
					this.newOracle()
				})
				this.addListener('reconnect-forex', async () => {
					await this.pause(5_000)
					log('Reconnecting FOREX websocket....')
					clearTimeout(timeoutpause)
					this.forex()
				})
			},
			async pause(milliseconds = 1000) {
				return new Promise(resolve => {
					console.log('pausing....')
					timeoutpause = setTimeout(resolve, milliseconds)
				})
			},
			connect() {
				
				const self = this
				if (ping !== undefined) {
                    clearInterval(ping)
                }
				socket = new WebSocket(process.env.APP_SOCKET)
				socket.onopen = async function (message) {
                    await self.waitForOpenConnection(socket)
					clearInterval(openConnectionInterval)

                    socket.send(JSON.stringify({
                        op: 'subscribe',
                        channel: 'threexrpl'
                    }))
					
                    ping = setInterval(function() {
                        socket.send(JSON.stringify({ op: 'ping' }))
                    }, 5_000)
                    console.log('socket_three trade sockets connected! :)')
					connected = true
                }
				socket.onclose = function (event) {
					connected = false
					console.log('socket closed', event)
					self.emit('reconnect-websocket')
				}
				socket.onerror = function (event) {
					connected = false
					console.log('socket error', event)
					self.emit('reconnect-websocket')
				}
			},
			async waitForOpenConnection(socket) {
                return new Promise((resolve, reject) => {
                    const maxNumberOfAttempts = 10
                    const intervalTime = 200 //ms

                    let currentAttempt = 0
                    openConnectionInterval = setInterval(() => {
                        if (currentAttempt > maxNumberOfAttempts - 1) {
                            reject(new Error('Maximum number of attempts exceeded'))
                        } else if (socket.readyState == 1) {
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
					}
				}
				socketFX.onclose = function (event) {
					self.emit('reconnect-forex')
				}
			},
		})
	}
}

dotenv.config()
log('starting..')
const main = new service()
main.run()
// main.cancel()


