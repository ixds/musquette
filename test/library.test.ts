
import { MQTTSubject } from '../src/library'
import { Subject } from 'rxjs'
import { AssertionError } from 'assert';

const mosca = require('mosca')

let port = 1883
const noop = () => { }
function startBroker(serverReady = noop, clientConnected = (client) => { }, published = (packet, client) => { }) {
  port = port + 1
  var server = new mosca.Server({port});

  server.on('clientConnected', clientConnected);

  server.on('published', published);

  server.on('ready', serverReady);

  return [port, server]
}

describe('Connect', async () => {
  let port, broker

  beforeEach((done) => {
    [port, broker] = startBroker(done)
  })

  afterEach((done) => {
    broker.close()
    done()
  })

  it('emits error if server cannot be found', (done) => {
    let subscription = new MQTTSubject(`mqtt://localhost:${1234}`).subscribe({
      error: (error: Error) => {
        expect(error.message).toContain('ECONNREFUSED')
        done()
      }
    })
  })

  it('supplied connectObserver is notified on connection', (done) => {
    expect.assertions(1)
    let connectObserver = new Subject()
    connectObserver.subscribe({
      next: (event) => {
        expect(event).toBeTruthy()
        done()
      }
    })
    new MQTTSubject({ url: `mqtt://localhost:${port}`, connectObserver }).subscribe()
  })

  it('supplied disconnectingObserver is notified when observable is completeddisconnect', (done) => {
    expect.assertions(1)
    let disconnectingObserver = new Subject<void>()
    disconnectingObserver.subscribe({
      next: (event) => {
        expect(event).toBeFalsy()
        done()
      }
    })
    let connection = new MQTTSubject({ url: `mqtt://localhost:${port}`, disconnectingObserver })
    connection.subscribe()
    connection.complete()
  })

  it('supplied disconnectObserver is notified on disconnect', (done) => {

    expect.assertions(1)
    let disconnectObserver = new Subject()
    disconnectObserver.subscribe({
      next: (event) => {
        expect(event).toBeFalsy()
        done()
      }
    })
    let connection = new MQTTSubject({ url: `mqtt://localhost:${port}`, disconnectObserver })
    connection.subscribe()
    connection.unsubscribe()
  })
])

describe('publishing', () => {

  it('publish message on topic', (done) => {
    const [port, broker] = startBroker(noop, noop, (packet) => {
      if (packet.topic !== 'topic')
        return
      let message = JSON.parse(packet.payload.toString())
      expect(message).toEqual('message')
      done()
    })
    expect.assertions(1)

    let connection = new MQTTSubject({ url: `mqtt://localhost:${port}`})
    connection.subscribe()
    connection.next({ topic: 'topic', message: 'message' })
  })

})

describe('topic', () => {

  it('listen to data published on the topic', done => {
    expect.assertions(2)
    const [port, broker] = startBroker(() => {
      let connection = new MQTTSubject(`mqtt://localhost:${port}`)
      // FIXME: Tis will probably not work, we need to be able to publish on a topic without subscription
      connection.subscribe()
      let topic = connection.topic('topic')
      topic.subscribe(({ topic, message }) => {
        expect(topic).toBe('topic')
        expect(message).toBe('message')
        broker.close
        done()
      })

      connection.next({
        topic: 'topic',
        message: 'message'
      })

      // broker.publish({
      //   topic: 'topic',
      //   payload: JSON.stringify('message'),
      //   qos: 0,
      //   retain: false
      // })
    }, noop, noop)
  })

  it('publish data on the topic', done => {
    expect.assertions(1)
    const [port, broker] = startBroker(() => {
      let connection = new MQTTSubject(`mqtt://localhost:${port}`)
      // FIXME: Tis will probably not work, we need to be able to publish on a topic without subscription
      connection.subscribe()
      let topic = connection.topic('topic')

      topic.next({
        topic: 'topic',
        message: 'message'
      })

    }, noop, ({topic, payload}) => {
        if (topic === 'topic') {
        const message = JSON.parse(payload.toString())
        expect(message).toBe('message')
        broker.close()
        done()
      }
    })
  })

})

