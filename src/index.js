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
		const ClientConnection = 'wss://slashdog.panicbot.xyz'

		let socket
		let socketFX
		let ping
		let oracle
		let memes = {}
		let fx

		Object.assign(this, {
		    async run() {
				log('runnig')
				this.pathATM()
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
			async pathATM() {
				const account = 'rThREeXrp54XTQueDowPV1RxmkEAGUmg8' // USE THE AMM POOL ADDRESS
				const key = 'ATM'

				const xrpl = new XrplClient([ClientConnection], { tryAllNodes: false })
				await xrpl.ready()

				const command = {
					command: 'path_find',
					id: '99-NoRipple-' + key,
					destination_account: account,
					send_max: { value: '1', currency: 'USD', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' },
					destination_amount: { value: '-1', currency: 'ATM', issuer: 'raDZ4t8WPXkmDfJWMLBcNZmmSHmBC523NZ' },
					source_account: account,
					// flags: 65536,
					subcommand: 'create'
				}
				// console.log(command)
				const path_result = await xrpl.send(command)
				// console.log('NoRippleDirect path_result', path_result)
				path_result.result.time = new Date().getTime()
				// memes[key] = path_result.result
				const self = this

				let atm_filter = new filter()
				
				xrpl.on('path', async (path) => {
					if ('error' in path) { return }

					if ('alternatives' in path && self.fx !== undefined) {
						path.time = new Date().getTime()
						const Price = path.alternatives[0].destination_amount.value
						const data = {}

						const values = [{
							p: new decimal(1 / Price).toFixed(10) * 1,
							e: 'XRPL',
							t: new Date().getTime(),
							s: 'socket'
						}]

						let bitrue 
						try {
							bitrue = await axios.get('https://openapi.bitrue.com/api/v1/ticker/bookTicker?symbol=ATMXUSDT')
							values.push({
								p: bitrue.data?.bidPrice * 1,
								e: 'bitrue',
								t: new Date().getTime(),
								s: 'rest'
							})
						} catch(e) {
							// do nothing
						}

						const agg = atm_filter.aggregate(values, 5000)


						data['USD'] = {
							Token: 'USD',
							Price: agg.filteredMean,
							Results: agg.rawExchanges.length,
							//Exchanges: agg.rawExchanges,
							LastRecord: agg.lastRecord,
							RawResults: agg.rawFiltered,
							// RawData: agg.rawData,
							Timestamp: agg.timestamp
						}

						// log(data['USD'])

						for (let index = 0; index < self.fx.length; index++) {
							const element = self.fx[index]
							if (element.target !== 'EUR' && element.target !== 'JPY' && element.target !== 'GBP' && element.target !== 'CHF'
								&& element.target !== 'CAD' && element.target !== 'AUD' && element.target !== 'CNY' ) {
									continue
							}
							data[element.target] = {
								Token: element.target,
								Price: element.rate * (1/ Price),
								Results: 1,
								RawResults: [{
									exchange: 'XRPL', 
									price: element.rate * (1/Price)
								}],
								Timestamp: new Date().getTime()
							}
						}
						
						// log(data)
						// log(memes[key])
						self.route('oracle-'+key, data)
					}
				})

				const hhhmmmm = async () => {
					console.log('upstream connection closed NoRippleDirect ' + key)
					memes[key] = undefined
				}
				xrpl.on('close', hhhmmmm)
				xrpl.on('error', (error) => {
					console.log('error pathing NoRippleDirect ' + key, error)
					memes[key] = undefined
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
				socket.onclose = function (event) {
					// need better reconnect here
					setTimeout(() => {
						self.forex()
					}, 10000)
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


