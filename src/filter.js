'use strict'

const EventEmitter = require('events')
const { XrplClient } = require('xrpl-client')
const stats = require('stats-analysis')
const decimal = require('decimal.js')
const debug = require('debug')
const log = debug('apps:filter')

module.exports = class filter extends EventEmitter {
    constructor(socket) {
        super()

		const cex = {}
		const dex = {}
		let trade_stats = ''
		let running = false
		

        Object.assign(this, {
            run(interval = 100, time = 5000) {
				const cex_results = {}

				if (!running)  {
					log('starting to listen for price')
					this.trades()
					this.pathing()
					running = true
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
				cex_results['STATS'] = {TradeVolume: trade_stats }
				
				setTimeout(() => {
					this.emit('oracle', cex_results)
					this.emit('dex', dex)
					this.run(interval, time)
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
						trade_stats = dollarUSLocale.format(new decimal(data.stats.t.s).toFixed(0))
					}
                }
                socket.on('message', handler)
            },
			async pathing(key = 'threepath') {
				const xrpl = new XrplClient(['wss://node.panicbot.xyz', 'wss://xrplcluster.com', 'wss://s2.ripple.com'])
				let lastUpdate = Date.now()
				const self = this
                const cmd = {
                    id: key,
                    command: 'path_find',
                    subcommand: 'create',
                    source_account: 'rThREeXrp54XTQueDowPV1RxmkEAGUmg8',
                    destination_account: 'rThREeXrp54XTQueDowPV1RxmkEAGUmg8',
                    destination_amount: '1000000' //  1 XRP
                }
                const result = await xrpl.send(cmd)
				const currencies = ['XAH', 'EUR', 'USD', 'USDT', 'USDC']
                // console.log('path init', result)
                xrpl.on('path', (path) => {
                    if ('error' in path) { return }
                    // console.log('path', path.alternatives)
					for (let index = 0; index < path.alternatives.length; index++) {
						const element = path.alternatives[index]
						const currency = this.currencyHexToUTF8(element.source_amount.currency)
						if (!currencies.includes(currency)) { continue }
						element.paths_computed.forEach(item => {
							if ('account' in item[0]) {
								if (dex[currency] === undefined) { dex[currency] = {} }
								dex[currency][item[0].account] = {
									Token: currency,
									Issuer: item[0].account,
									Price: element.source_amount.value,
									Timestamp: Date.now(),
								}
							}
						})
					}
					lastUpdate = Date.now()
                })
				const interval = setInterval(() => {
					if (Date.now() - lastUpdate > 180000) {
						log('retstarting pathing..')
						xrpl.close()
						self.pathing()
						clearInterval(interval)
					}
				}, 4000)
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
        })
    }
}