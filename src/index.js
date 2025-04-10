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
		let memes = {}
		let fx

		Object.assign(this, {
		    async run() {
				log('runnig')
				this.pathATM()
				this.pathXAH()
				this.pathEVR()
				this.forex()
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
                    }, 5_000)
                    console.log('socket_three trade sockets connected! :)')
                }
				socket.onclose = function (event) {
					// need better reconnect here
					console.log('socket closed', event)
					setTimeout(() => {
						self.connect()
					}, 10_000)
				}
				socket.onerror = function (event) {
					// need better reconnect here
					console.log('socket error', event)
					setTimeout(() => {
						self.connect()
					}, 10_000)
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
			route(channel, message) {
				const string = '{"' + channel +'": ' + JSON.stringify(message) + '}'
				wss.clients.forEach(function each(client) {
					client.send(string)
				})
			},
			async pathXAH() {
				const account = 'rThREeXrp54XTQueDowPV1RxmkEAGUmg8' // USE THE AMM POOL ADDRESS
				const key = 'XAH'

				const xrpl = new XrplClient(ClientConnection, { tryAllNodes: false })
				await xrpl.ready()

				const command = {
					command: 'path_find',
					id: '66-oracle-' + key,
					destination_account: account,
					send_max: { value: '1', currency: 'USD', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' },
					destination_amount: { value: '-1', currency: 'XAH', issuer: 'rswh1fvyLqHizBS2awu1vs6QcmwTBd9qiv' },
					source_account: account,
					// flags: 65536,
					subcommand: 'create'
				}
				const path_result = await xrpl.send(command)
				if ('error' in path_result) { return }
				path_result.result.time = new Date().getTime()
				const self = this

				let atm_filter = new filter()
				
				xrpl.on('path', async (path) => {
					if ('error' in path) { return }

					try {
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
								bitrue = await axios.get('https://openapi.bitrue.com/api/v1/ticker/bookTicker?symbol=XAHUSDT')
								values.push({
									p: bitrue.data?.bidPrice * 1,
									e: 'bitrue',
									t: new Date().getTime(),
									s: 'rest'
								})
							} catch(e) {
								// do nothing
							}
							let bitmart
							try {
								bitmart = await axios.get('https://api-cloud.bitmart.com/spot/quotation/v3/ticker?symbol=XAH_USDT')
								values.push({
									p: bitmart.data.data?.bid_px * 1,
									e: 'bitmart',
									t: new Date().getTime(),
									s: 'rest'
								})
							} catch(e) {
								// do nothing
							}
							let coinex
							try {
								coinex = await axios.get('https://api.coinex.com/v2/spot/ticker?market=XAHUSDT')
								values.push({
									p: coinex.data.data[0].last * 1,
									e: 'coinex',
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
	
							for (let index = 0; index < self.fx.length; index++) {
								const element = self.fx[index]
								if (element.target !== 'EUR' && element.target !== 'JPY' && element.target !== 'GBP' && element.target !== 'CHF'
									&& element.target !== 'CAD' && element.target !== 'AUD' && element.target !== 'CNY' ) {
										continue
								}
								data[element.target] = {
									Token: element.target,
									Price: new decimal(element.rate * (1/ Price)).toFixed(10) * 1,
									Results: 1,
									RawResults: [{
										exchange: 'XRPL', 
										price: new decimal(element.rate * (1/ Price)).toFixed(10) * 1
									}],
									Timestamp: new Date().getTime()
								}
							}

							self.route('oracle-'+key, data)
						}
					} catch(e) {
						log('error', e)
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
			async pathEVR() {
				const account = 'rThREeXrp54XTQueDowPV1RxmkEAGUmg8' // USE THE AMM POOL ADDRESS
				const key = 'EVR'

				const xrpl = new XrplClient(ClientConnection, { tryAllNodes: false })
				await xrpl.ready()

				const command = {
					command: 'path_find',
					id: '66-oracle-' + key,
					destination_account: account,
					send_max: { value: '1', currency: 'USD', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' },
					destination_amount: { value: '-1', currency: 'EVR', issuer: 'ra9g3LAJm9xJu8Awe7oWzR6VXFB1mpFtSe' },
					source_account: account,
					// flags: 65536,
					subcommand: 'create'
				}
				const path_result = await xrpl.send(command)
				if ('error' in path_result) { return }
				path_result.result.time = new Date().getTime()
				const self = this

				let atm_filter = new filter()
				
				xrpl.on('path', async (path) => {
					if ('error' in path) { return }

					try {
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
	 
							try {
								const coinex = await axios.get('https://api.coinex.com/v2/spot/ticker?market=EVRUSDT')
								values.push({
									p: coinex.data.data[0].last * 1,
									e: 'coinex',
									t: new Date().getTime(),
									s: 'rest'
								})
							} catch(e) {
								// do nothing
							}
							try {
								const bitrue = await axios.get('https://openapi.bitrue.com/api/v1/ticker/bookTicker?symbol=EVRUSDT')
								values.push({
									p: bitrue.data?.bidPrice * 1,
									e: 'bitrue',
									t: new Date().getTime(),
									s: 'rest'
								})
							} catch(e) {
								// do nothing
								log('error', e)
							}

							try {
								const bitmart = await axios.get('https://api-cloud.bitmart.com/spot/quotation/v3/ticker?symbol=EVR_USDT')
								values.push({
									p: bitmart.data?.data?.bid_px * 1,
									e: 'bitmart',
									t: new Date().getTime(),
									s: 'rest'
								})
							} catch(e) {
								// do nothing
								log('error', e)
							}

							try {
								const mexc = await axios.get('https://api.mexc.com/api/v3/ticker/price?symbol=EVRUSDT')
								values.push({
									p: mexc.data?.price * 1,
									e: 'mexc',
									t: new Date().getTime(),
									s: 'rest'
								})
							} catch(e) {
								// do nothing
								log('error', e)
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
	
							for (let index = 0; index < self.fx.length; index++) {
								const element = self.fx[index]
								if (element.target !== 'EUR' && element.target !== 'JPY' && element.target !== 'GBP' && element.target !== 'CHF'
									&& element.target !== 'CAD' && element.target !== 'AUD' && element.target !== 'CNY' ) {
										continue
								}
								data[element.target] = {
									Token: element.target,
									Price: new decimal(element.rate * (1/ Price)).toFixed(10) * 1,
									Results: 1,
									RawResults: [{
										exchange: 'XRPL', 
										price: new decimal(element.rate * (1/ Price)).toFixed(10) * 1
									}],
									Timestamp: new Date().getTime()
								}
							}
							
							self.route('oracle-'+key, data)
						}
					} catch(e) {
						log('error', e)
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
			async pathATM() {
				const account = 'rThREeXrp54XTQueDowPV1RxmkEAGUmg8' // USE THE AMM POOL ADDRESS
				const key = 'ATM'

				const xrpl = new XrplClient(ClientConnection, { tryAllNodes: false })
				await xrpl.ready()

				const command = {
					command: 'path_find',
					id: '66-oracle-' + key,
					destination_account: account,
					send_max: { value: '1', currency: 'USD', issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' },
					destination_amount: { value: '-1', currency: 'ATM', issuer: 'raDZ4t8WPXkmDfJWMLBcNZmmSHmBC523NZ' },
					source_account: account,
					// flags: 65536,
					subcommand: 'create'
				}
				const path_result = await xrpl.send(command)
				if ('error' in path_result) { return }
				path_result.result.time = new Date().getTime()
				const self = this

				let atm_filter = new filter()
				
				xrpl.on('path', async (path) => {
					if ('error' in path) { return }

					try {
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
	
							for (let index = 0; index < self.fx.length; index++) {
								const element = self.fx[index]
								if (element.target !== 'EUR' && element.target !== 'JPY' && element.target !== 'GBP' && element.target !== 'CHF'
									&& element.target !== 'CAD' && element.target !== 'AUD' && element.target !== 'CNY' ) {
										continue
								}
								data[element.target] = {
									Token: element.target,
									Price: new decimal(element.rate * (1/ Price)).toFixed(10) * 1,
									Results: 1,
									RawResults: [{
										exchange: 'XRPL', 
										price: new decimal(element.rate * (1/ Price)).toFixed(10) * 1
									}],
									Timestamp: new Date().getTime()
								}
							}

							self.route('oracle-'+key, data)
						}
					} catch(e) {
						log('error', e)
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
					}
				}
				socketFX.onclose = function (event) {
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


