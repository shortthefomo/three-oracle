'use strict'

const EventEmitter = require('events')
const { XrplClient } = require('xrpl-client')
const stats = require('stats-analysis')
const decimal = require('decimal.js')
const debug = require('debug')
const log = debug('apps:filter')

module.exports = class filter extends EventEmitter {
    constructor(socket, def = true) {
        super()
		
		const ClientConnection = [process.env.APP_XRPL, 'wss://xrplcluster.com', 'wss://xrpl.link', 'wss://s2.ripple.com']
		const cex = {}
		const dex = {}
		let trade_stats = ''
		let running = false
		let timeout = undefined
        Object.assign(this, {
            run(interval = 100, time = 5000) {
				if (!def) { return }
				if (timeout !== undefined) { clearTimeout(timeout) }
				const cex_results = {}
				
				if (!running)  {
					log('starting to listen for price')
					this.trades()
					// this.pathing()
					// this.pathEmit()
					running = true

					this.addListener('run', function(interval, time) {
						this.run(interval, time)				
					})
				}

				Object.entries(cex).forEach(([token, value]) => {
					const agg = this.aggregate(value, time)
					if (agg !== false) { 
						cex_results[token] = {
							Token: token,
							Price: agg.filteredMean,
							Results: agg.rawExchanges.length,
							//Exchanges: agg.rawExchanges,
							LastRecord: agg.lastRecord,
							RawResults: agg.rawFiltered,
							// RawData: agg.rawData,
							Timestamp: agg.timestamp
						}
					}
				})
				cex_results['STATS'] = trade_stats
				
				timeout = setTimeout(() => {
					this.emit('oracle', cex_results)
					this.emit('run', interval, time)
				}, interval)
			},
            aggregate(results, time) {
				//log('results', Object.values(results))
				if (results === undefined) { return false }
				const timeFiltered = Object.values(results).filter((item) => item.t > Date.now() - time)
				const rawFiltered = Object.values(timeFiltered).map((item) => { 
                    return {exchange: item.e, price: item.p}
                })
				const rawExchanges = Object.values(timeFiltered).map((item) => { 
                    return item.e
                })
				const rawResults = Object.values(timeFiltered).map((item) => { 
                    return item.p
                })
				const rawTimeFiltered = Object.values(timeFiltered).map((item) => { 
                    return item.t
                })
				// log('rawResults', rawResults)
                const summed = Object.values(timeFiltered).map((item) => {
                    return item.a
                })
				const lastRecord = Math.max(...rawTimeFiltered)
				const firstRecord = Math.min(...rawTimeFiltered)
				if (summed.length === 0) { return false }
                const sum = summed.reduce((total, item) => total + item)
                const avg = sum / Object.values(timeFiltered).length
				const rawMedian = stats.median(rawResults)
				let rawStdev = stats.stdev(rawResults)
			
				const raw = {
					rawData: timeFiltered,
					rawResults,
					rawMedian: new decimal(rawMedian).toFixed(8) * 1,
					rawStdev: new decimal(rawStdev).toFixed(8) * 1
				}
			
				// filter fails on a zero value
				if (rawStdev == 0) {
					rawStdev = new decimal(0.00000001).toFixed(8)
				}
			
				const filteredResults = this.filter(rawResults, rawMedian, rawStdev)
				if (filteredResults === undefined || filteredResults.length === 0) { return false }
				const filteredMedian = stats.median(filteredResults)
				const filteredMean = stats.mean(filteredResults)
			
				const filtered = {
					filteredResults,
					filteredMedian: new decimal(filteredMedian).toFixed(8) * 1,
					filteredMean: new decimal(filteredMean).toFixed(8) * 1
				}
			
				return {
					...raw,
					...filtered,
					rawExchanges,
					rawFiltered,
                    average: new decimal(avg).toFixed(4)*1,
                    total: new decimal(sum).toFixed(4)*1,
					timestamp: lastRecord,
					lastRecord: Date.now() - lastRecord,
					firstRecord: Date.now() - firstRecord
				}
			},
			filter(rawResults, rawMedian, rawStdev) {
				const results = []
				for (let index = 0; index < rawResults.length; index++) {
					const r = new decimal(rawResults[index])
					const m = new decimal(rawMedian)
					const d = new decimal(rawStdev)
					// console.log('r m d', r.toFixed(8) , m.toFixed(8), d.toFixed(8))
					const abs = Math.abs(r.minus(m).toFixed(8))
			
					// console.log('abs', abs)
					if (new decimal(abs).lessThanOrEqualTo(d.toFixed(8))) {
						results.push(r.toFixed(8) * 1)
					}
				}
			
				// console.log('results', results)
				return results
			},
            async trades() {
                const handler = function(message) {
                    const string = message.toString()
                    
                    const data  = JSON.parse(string)
					
                    if ('stable' in data  && data.stable.s === 'socket') {
						if (cex[data.stable.f] === undefined) { cex[data.stable.f] = {} }
                        cex[data.stable.f][data.stable.e] = data.stable
                    }
                    if ('trade' in data  && data.trade.s === 'socket') {
						if (cex[data.trade.f] === undefined) { cex[data.trade.f] = {} }
                        cex[data.trade.f][data.trade.e] = data.trade
                    }
					if ('others' in data  && data.others.s === 'socket') {
						if (cex[data.others.f] === undefined) { cex[data.others.f] = {} }
                        cex[data.others.f][data.others.e] = data.others
                    }
					if ('stats' in data) {
						let dollarUSLocale = Intl.NumberFormat('en-US')
						trade_stats = data.stats
					}
					// log(data)
                }
                socket.on('message', handler)
            },
			currencyHexToUTF8(code) {
				if (code.length === 3)
					return code

				let decoded = new TextDecoder()
					.decode(this.hexToBytes(code))
				let padNull = decoded.length

				while (decoded.charAt(padNull - 1) === '\0')
					padNull--

				return decoded.slice(0, padNull)
			},
            hexToBytes(hex) {
				let bytes = new Uint8Array(hex.length / 2)

				for (let i = 0; i !== bytes.length; i++) {
					bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
				}

				return bytes
			},
			async pathRLUSD() {
				const account = 'rThREeXrp54XTQueDowPV1RxmkEAGUmg8' // USE THE AMM POOL ADDRESS
				const key = 'RLUSD'

				const xrpl = new XrplClient(ClientConnection, { tryAllNodes: false })
				await xrpl.ready()

				const command = {
					command: 'path_find',
					id: '99-oracle-' + key,
					destination_account: account,
					send_max: { value: '1', currency: '524C555344000000000000000000000000000000', issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De' },
					destination_amount: '-1',
					source_account: account,
					// flags: 65536,
					subcommand: 'create'
				}
				
				const path_result = await xrpl.send(command)
				if ('error' in path_result) { return }
				path_result.result.time = new Date().getTime()
				
				xrpl.on('path', async (path) => {
					if ('error' in path) { return }

					try {
						if ('alternatives' in path && path.alternatives.length > 0) {
							// log(path.alternatives)
							path.time = new Date().getTime()
							const Price = path.alternatives[0].destination_amount / 1_000_000
							if (cex['RLUSD'] === undefined) {
								cex['RLUSD'] = {}
							}

							cex['RLUSD']['XRPL'] = {
								f: 'RLUSD',
								a: 1,
								p: new decimal(1 / Price).toFixed(10) * 1,
								e: 'XRPL',
								t: new Date().getTime(),
								s: 'socket'
							}
						}
					} catch(e) {
						log('error', e)
					}
				})

				const hhhmmmm = async () => {
					console.log('upstream connection closed NoRippleDirect ' + key)
				}
				xrpl.on('close', hhhmmmm)
				xrpl.on('error', (error) => {
					console.log('error pathing NoRippleDirect ' + key, error)
				})
			},
			async pathUSDC() {
				const account = 'rThREeXrp54XTQueDowPV1RxmkEAGUmg8' // USE THE AMM POOL ADDRESS
				const key = 'USDC'

				const xrpl = new XrplClient(ClientConnection, { tryAllNodes: false })
				await xrpl.ready()

				const command = {
					command: 'path_find',
					id: '99-oracle-' + key,
					destination_account: account,
					send_max: { value: '1', currency: '5553444300000000000000000000000000000000', issuer: 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE' },
					destination_amount: '-1',
					source_account: account,
					// flags: 65536,
					subcommand: 'create'
				}
				
				const path_result = await xrpl.send(command)
				if ('error' in path_result) { return }
				path_result.result.time = new Date().getTime()
				
				xrpl.on('path', async (path) => {
					if ('error' in path) { return }

					try {
						if ('alternatives' in path && path.alternatives.length > 0) {
							// log(path.alternatives)
							path.time = new Date().getTime()
							const Price = path.alternatives[0].destination_amount / 1_000_000

							if (cex['USDC'] === undefined) {
								cex['USDC'] = {}
							}

							cex['USDC']['XRPL'] = {
								f: 'USDC',
								a: 1,
								p: new decimal(1 / Price).toFixed(10) * 1,
								e: 'XRPL',
								t: new Date().getTime(),
								s: 'socket'
							
							}
						}
					} catch(e) {
						log('error', e)
					}
				})

				const hhhmmmm = async () => {
					console.log('upstream connection closed NoRippleDirect ' + key)
				}
				xrpl.on('close', hhhmmmm)
				xrpl.on('error', (error) => {
					console.log('error pathing NoRippleDirect ' + key, error)
				})
			},
			async pathCSC() {
				const account = 'rThREeXrp54XTQueDowPV1RxmkEAGUmg8' // USE THE AMM POOL ADDRESS
				const key = 'CSC'

				const xrpl = new XrplClient(ClientConnection, { tryAllNodes: false })
				await xrpl.ready()

				const command = {
					command: 'path_find',
					id: '99-oracle-' + key,
					destination_account: account,
					send_max: '1000000' ,
					destination_amount: { value: '-1', currency: 'CSC', issuer: 'rCSCManTZ8ME9EoLrSHHYKW8PPwWMgkwr' },
					source_account: account,
					// flags: 65536,
					subcommand: 'create'
				}
				
				const path_result = await xrpl.send(command)
				if ('error' in path_result) { return }
				path_result.result.time = new Date().getTime()
				
				xrpl.on('path', async (path) => {
					if ('error' in path) { return }

					try {
						if ('alternatives' in path) {
							path.time = new Date().getTime()
							if (cex['CSC'] === undefined) {
								cex['CSC'] = {}
							}

							cex['CSC']['XRPL'] = {
								f: 'CSC',
								a: 1,
								p: path.alternatives[0].destination_amount.value,
								e: 'XRPL',
								t: new Date().getTime(),
								s: 'socket'
							}
						}
					} catch(e) {
						log('error', e)
					}
				})

				const hhhmmmm = async () => {
					console.log('upstream connection closed NoRippleDirect ' + key)
				}
				xrpl.on('close', hhhmmmm)
				xrpl.on('error', (error) => {
					console.log('error pathing NoRippleDirect ' + key, error)
				})
			},
			async pathXAH() {
				const account = 'rThREeXrp54XTQueDowPV1RxmkEAGUmg8' // USE THE AMM POOL ADDRESS
				const key = 'XAH'

				const xrpl = new XrplClient(ClientConnection, { tryAllNodes: false })
				await xrpl.ready()

				const command = {
					command: 'path_find',
					id: '99-oracle-' + key,
					destination_account: account,
					send_max: '1000000',
					destination_amount: { value: '-1', currency: 'XAH', issuer: 'rswh1fvyLqHizBS2awu1vs6QcmwTBd9qiv' },
					source_account: account,
					// flags: 65536,
					subcommand: 'create'
				}
				
				const path_result = await xrpl.send(command)
				if ('error' in path_result) { return }
				path_result.result.time = new Date().getTime()
				
				xrpl.on('path', async (path) => {
					if ('error' in path) { return }

					try {
						if ('alternatives' in path) {
							path.time = new Date().getTime()

							if (cex['XAH'] === undefined) {
								cex['XAH'] = {}
							}

							cex['XAH']['XRPL'] = {
								f: 'XAH',
								a: 1,
								p: path.alternatives[0].destination_amount.value,
								e: 'XRPL',
								t: new Date().getTime(),
								s: 'socket'
							}
						}
					} catch(e) {
						log('error', e)
					}
				})

				const hhhmmmm = async () => {
					console.log('upstream connection closed NoRippleDirect ' + key)
				}
				xrpl.on('close', hhhmmmm)
				xrpl.on('error', (error) => {
					console.log('error pathing NoRippleDirect ' + key, error)
				})
			},
			async pathEVR() {
				const account = 'rThREeXrp54XTQueDowPV1RxmkEAGUmg8' // USE THE AMM POOL ADDRESS
				const key = 'EVR'

				const xrpl = new XrplClient(ClientConnection, { tryAllNodes: false })
				await xrpl.ready()

				const command = {
					command: 'path_find',
					id: '99-oracle-' + key,
					destination_account: account,
					send_max: '1000000',
					destination_amount: { value: '-1', currency: 'EVR', issuer: 'ra9g3LAJm9xJu8Awe7oWzR6VXFB1mpFtSe' },
					source_account: account,
					// flags: 65536,
					subcommand: 'create'
				}
				
				const path_result = await xrpl.send(command)
				if ('error' in path_result) { return }
				path_result.result.time = new Date().getTime()
				
				xrpl.on('path', async (path) => {
					if ('error' in path) { return }

					try {
						if ('alternatives' in path) {
							path.time = new Date().getTime()

							if (cex['EVR'] === undefined) {
								cex['EVR'] = {}
							}
							cex['EVR']['XRPL'] = {
								f: 'EVR',
								a: 1,
								p: path.alternatives[0].destination_amount.value,
								e: 'XRPL',
								t: new Date().getTime(),
								s: 'socket'
							}
						}
					} catch(e) {
						log('error', e)
					}
				})

				const hhhmmmm = async () => {
					console.log('upstream connection closed NoRippleDirect ' + key)
				}
				xrpl.on('close', hhhmmmm)
				xrpl.on('error', (error) => {
					console.log('error pathing NoRippleDirect ' + key, error)
				})
			},
        })
		this.pathRLUSD()
		this.pathUSDC()
		this.pathEVR()
		this.pathXAH()
		this.pathCSC()
    }
}