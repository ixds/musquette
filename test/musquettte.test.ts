import { MQTTSubject, connect } from '../src/musquette'
import { Subject } from 'rxjs'

const mosca = require('mosca')

let port = 1884
const noop = () => {}

// TODO: await broker ready
function startBroker(
  serverReady = noop,
  clientConnected = client => {},
  published = (packet, client) => {},
  failed = () => {}
) {
  port = port + 1
  var server = new mosca.Server({ port })

  server.on('clientConnected', clientConnected)

  server.on('published', published)

  server.on('ready', serverReady)

  setTimeout(() => {
    server.close()
    failed()
  }, 6000)

  return [port, server]
}

describe('Connect', () => {
  let port, broker

  beforeEach(done => {
    ;[port, broker] = startBroker(done)
  })

  afterEach(done => {
    broker.close()
    done()
  })

  it('emits error if server cannot be found', done => {
    let subscription = new MQTTSubject(`mqtt://localhost:${1234}`).subscribe({
      error: (error: Error) => {
        expect(error.message).toContain('ECONNREFUSED')
        done()
      }
    })
  })

  it('supplied connectObserver is notified on connection', done => {
    expect.assertions(1)
    let connectObserver = new Subject()
    connectObserver.subscribe({
      next: event => {
        expect(event).toHaveProperty('cmd', 'connack')
        done()
      }
    })
    new MQTTSubject({ url: `mqtt://localhost:${port}`, connectObserver }).subscribe()
  })

  it('supplied disconnectingObserver is notified when observable is completed', done => {
    expect.assertions(1)
    let disconnectingObserver = new Subject<void>()
    disconnectingObserver.subscribe({
      next: event => {
        expect(event).toBeFalsy()
        done()
      }
    })
    let connection = new MQTTSubject({ url: `mqtt://localhost:${port}`, disconnectingObserver })
    connection.subscribe()
    connection.complete()
  })

  it('supplied disconnectObserver is notified on disconnect', done => {
    expect.assertions(1)
    let disconnectObserver = new Subject()
    disconnectObserver.subscribe({
      next: event => {
        expect(event).toBeFalsy()
        done()
      }
    })
    let connection = new MQTTSubject({ url: `mqtt://localhost:${port}`, disconnectObserver })
    connection.subscribe()
    connection.complete()
  })

  it('connect should return subscription to MQTTSubject with the passed configuration', done => {
    expect.assertions(1)
    let connectObserver = new Subject()
    connectObserver.subscribe({
      next: event => {
        expect(event).toHaveProperty('cmd', 'connack')
        done()
      }
    })
    connect({ url: `mqtt://localhost:${port}`, connectObserver }).subscribe()
  })
})

describe('publishing', () => {
  it('publish message as MQTTMessage', done => {
    expect.assertions(1)
    const [port, broker] = startBroker(
      () => {
        let connection = new MQTTSubject({ url: `mqtt://localhost:${port}` })
        connection.subscribe()
        connection.next({ topic: 'topic', message: 'message' })
      },
      noop,
      packet => {
        if (packet.topic !== 'topic') return
        let message = JSON.parse(packet.payload.toString())
        expect(message).toEqual('message')
        broker.close()
        done()
      }
    )
  })

  it('publish message as MQTTMessage without subscribing first', done => {
    expect.assertions(1)
    const [port, broker] = startBroker(
      () => {
        let connection = new MQTTSubject({ url: `mqtt://localhost:${port}` })
        connection.next({ topic: 'topic', message: 'message' })
      },
      noop,
      packet => {
        if (packet.topic !== 'topic') return
        let message = JSON.parse(packet.payload.toString())
        expect(message).toEqual('message')
        broker.close()
        done()
      }
    )
  })

  it('publish message with arguments syntax', done => {
    expect.assertions(1)
    const [port, broker] = startBroker(
      () => {
        let connection = new MQTTSubject({ url: `mqtt://localhost:${port}` })
        connection.subscribe()
        connection.publish('topic', 'message')
      },
      noop,
      packet => {
        if (packet.topic !== 'topic') return
        let message = JSON.parse(packet.payload.toString())
        expect(message).toEqual('message')
        broker.close()
        done()
      },
      done
    )
  })
})

describe('topic', () => {
  it('listen to data published on the topic', done => {
    expect.assertions(2)
    const [port, broker] = startBroker(
      () => {
        let connection = new MQTTSubject(`mqtt://localhost:${port}`)
        connection.subscribe()
        let topic = connection.topic('topic')
        topic.subscribe(({ topic, message }) => {
          expect(topic).toBe('topic')
          expect(message).toBe('message')
          broker.close()
          done()
        })

        setTimeout(() => {
          broker.publish({
            topic: 'topic',
            payload: JSON.stringify('message'),
            qos: 0,
            retain: true
          })
        }, 300)
      },
      noop,
      noop
    )
  })

  it('warn if topic starts with a slash', done => {
    expect.assertions(1)
    const [port, broker] = startBroker(
      () => {
        let warning = jest.fn()
        console.warn = warning
        let connection = new MQTTSubject(`mqtt://localhost:${port}`)
        let topic = connection.topic('/topic')
        topic.subscribe()
        setTimeout(() => {
          expect(warning).toHaveBeenCalled()
          broker.close()
          done()
        }, 1000)
      },
      noop,
      noop
    )
  })

  it('publish data on the topic', done => {
    expect.assertions(1)
    const [port, broker] = startBroker(
      () => {
        let connection = new MQTTSubject(`mqtt://localhost:${port}`)
        connection.subscribe()
        let topic = connection.topic('topic')

        topic.next({
          topic: 'topic',
          message: 'message'
        })
      },
      noop,
      ({ topic, payload }) => {
        if (topic === 'topic') {
          const message = JSON.parse(payload.toString())
          expect(message).toBe('message')
          broker.close()
          done()
        }
      }
    )
  })

  it('publish data on the topic with arguments', done => {
    expect.assertions(1)
    const [port, broker] = startBroker(
      () => {
        let connection = new MQTTSubject(`mqtt://localhost:${port}`)
        connection.subscribe()
        let topic = connection.topic('topic')

        topic.publish('message')
      },
      noop,
      ({ topic, payload }) => {
        if (topic === 'topic') {
          const message = JSON.parse(payload.toString())
          expect(message).toBe('message')
          broker.close()
          done()
        }
      }
    )
  })

  it('publish data on topic without subscribing first', done => {
    expect.assertions(1)
    const [port, broker] = startBroker(
      () => {
        let connection = new MQTTSubject(`mqtt://localhost:${port}`)
        let topic = connection.topic('topic')

        topic.next({
          topic: 'topic',
          message: 'message'
        })
      },
      noop,
      ({ topic, payload }) => {
        if (topic === 'topic') {
          const message = JSON.parse(payload.toString())
          expect(message).toBe('message')
          broker.close()
          done()
        }
      }
    )
  })

  it('published messages are not sent to all clients', done => {
    let [port, broker] = startBroker(() => {
      let never = jest.fn()
      let connection = new MQTTSubject(`mqtt://localhost:${port}`)
      connection.subscribe(never)

      connection.publish('t', {})
      connection.next({ topic: 't', message: {} })

      setTimeout(() => {
        expect(never).not.toHaveBeenCalled()
        broker.close()
        done()
      }, 1000)
    })
  })
})

describe('wildcards', () => {
  it('listen to data published on a # wildcard topic', done => {
    expect.assertions(2)
    const [port, broker] = startBroker(
      () => {
        let connection = new MQTTSubject(`mqtt://localhost:${port}`)
        let topic = connection.topic('topic/#')
        let subscription = topic.subscribe(({ topic, message }) => {
          expect(topic).toBe('topic/topic')
          expect(message).toBe('message')
          subscription.unsubscribe()
          broker.close()
          done()
        })
        setTimeout(() => {
          broker.publish({
            topic: 'topic/topic',
            payload: JSON.stringify('message'),
            qos: 0,
            retain: false
          })
        }, 300)
      },
      noop,
      noop
    )
  })

  it('listen to data published on a + wildcard topic', done => {
    expect.assertions(2)
    const [port, broker] = startBroker(
      () => {
        let connection = new MQTTSubject(`mqtt://localhost:${port}`)
        let topic = connection.topic('topic/+/topic')
        let subscription = topic.subscribe(({ topic, message }) => {
          expect(topic).toBe('topic/topic/topic')
          expect(message).toBe('message')
          subscription.unsubscribe()
          broker.close()
          done()
        })

        setTimeout(() => {
          broker.publish({
            topic: 'topic/topic/topic',
            payload: JSON.stringify('message'),
            qos: 0,
            retain: false
          })
        }, 300)
      },
      noop,
      noop
    )
  })

  // it('publishing on wildcard topic throws an error with publish method', done => {
  //   expect.assertions(1)
  //   const [port, broker] = startBroker(
  //     () => {
  //       try {
  //         let connection = new MQTTSubject(`mqtt://localhost:${port}`)
  //         connection.subscribe()
  //         let topic = connection.topic('topic/#')

  //         topic.publish('message')
  //       } catch (err) {
  //         // TODO: Standardize error types
  //         expect(err.message).toContain('INVALIDTOPIC')
  //         // broker.close()
  //         done()
  //       }
  //     },
  //     noop,
  //     noop,
  //     done
  //   )
  // })

  it('publishing on wildcard topic throws an error with next', done => {
    expect.assertions(1)
    const [port, broker] = startBroker(
      () => {
        let connection = new MQTTSubject(`mqtt://localhost:${port}`)
        connection.subscribe({
          error: err => {
            expect(err.message).toContain('ERR_INVALID_ARG_TYPE')
            broker.close()
            done()
          }
        })
        let topic = connection.topic('topic/#')

        topic.next('message')
      },
      noop,
      noop,
      done
    )
  })

  it('publishing data as MQTTMessage type on a wildcard topic works, aka specifying a topic to publish on', done => {
    expect.assertions(1)
    const [port, broker] = startBroker(
      () => {
        let connection = new MQTTSubject(`mqtt://localhost:${port}`)
        connection.subscribe()
        let topic = connection.topic('topic/#')

        topic.next({
          topic: 'topic',
          message: 'message'
        })
      },
      noop,
      ({ topic, payload }) => {
        if (topic === 'topic') {
          const message = JSON.parse(payload.toString())
          expect(message).toBe('message')
          broker.close()
          done()
        }
      }
    )
  })
})
