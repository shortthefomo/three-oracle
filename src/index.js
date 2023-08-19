'use strict'

const WebSocket = require('ws')
const decimal = require('decimal.js')
const dotenv = require('dotenv')
const debug = require('debug')
const log = debug('apps:oracle')
const filter = require('./filter.js')
class service  {
	constructor() {
		let socket
		let ping
		let pairs = {}
		Object.assign(this, {
		    async run() {
				log('runnig')
				this.connect()

				// const usd = new filter(socket)
				// usd.loop('USD', 5)
				// usd.on('USD', (event) => {
				// 	pairs['USD'] = event
					
				// 	if ('direction' in pairs['USDT']) {
				// 		let t = Math.abs(new decimal(event.price).minus(pairs['USDT'].price))
				// 		let m = (new decimal(event.price).plus(pairs['USDT'].price)).div('2')
				// 		let s = decimal.mul(t, '100').div(m)

				// 		const l = {
				// 			direction: pairs['USDT'].direction,
				// 			USDT: pairs['USDT'].price,
				// 			USD: event.price,
				// 			s: s.toFixed(5)
				// 		}
				// 		log(l)
				// 	}
				// })
				
				const oracle = new filter(socket)
				oracle.run(250, 60000)

				oracle.on('oracle', (event) => {
					// const keysSorted = Object.keys(event).sort((a, b) => (a.Price > b.Price) ? 1 : -1)
					
					// let list = []
					// for (let index = 0; index < keysSorted.length; index++) {
					// 	const element = keysSorted[index]
					// 	list.push({ element: event[element]})
					// }

					log(event)
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
				socket.onmessage = function(event) { 
					const data  = JSON.parse(event.data)
					if (!('stats' in data)) { return }
					log(data.stats)
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
		})
	}
}

dotenv.config()
log('starting..')
const main = new service()
main.run()
// main.cancel()


