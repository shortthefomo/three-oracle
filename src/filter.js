'use strict'

const EventEmitter = require('events')
const stats = require('stats-analysis')
const decimal = require('decimal.js')
const debug = require('debug')
const log = debug('apps:filter')

module.exports = class filter extends EventEmitter {
    constructor(socket) {
        super()

		const list = {}
		let running = false
        Object.assign(this, {
            run(interval = 100, time = 5000) {
				const results = {}
				if (!running)  {
					log('starting to listen for price')
					this.trades()
					running = true
				}

				Object.entries(list).forEach(([token, value]) => {					
					const agg = this.aggregate(value, time)
					if (agg !== false) { 
						results[token] = {
							// token,
							Price: agg.filteredMean,
							// AverageUnits: agg.average,
							// TotalUnits: agg.total,
							Results: agg.rawExchanges.length,
							// Exchanges: agg.rawExchanges,
							LastRecord: agg.lastRecord,
							// RawResults: agg.rawResults,
							// RawData: agg.rawData,
							// Timestamp: agg.timestamp
							// FirstRecord: agg.firstRecord							
						}
					}
				})
				setTimeout(() => {
					this.emit('oracle', results)
					this.run(interval, time)
				}, interval)
			},
            aggregate(results, time) {
				//log('results', Object.values(results))
				if (results === undefined) { return false }
				const timeFiltered = Object.values(results).filter((item) => item.t > Date.now() - time)
				// log('timeFiltered', timeFiltered)
				const rawExchanges =  Object.values(timeFiltered).map((item) => { 
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
						if (list[data.stable.f] === undefined) { list[data.stable.f] = {} }
                        list[data.stable.f][data.stable.e] = data.stable
                    }
                    if ('trade' in data  && data.trade.s === 'socket') {
						if (list[data.trade.f] === undefined) { list[data.trade.f] = {} }
                        list[data.trade.f][data.trade.e] = data.trade
                    }
                }
                socket.on('message', handler)
            },
        })
    }
}