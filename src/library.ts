import { Subject, AnonymousSubject } from 'rxjs/internal/Subject'
import {
  Subscriber,
  Observable,
  Subscription,
  Operator,
  ReplaySubject,
  Observer,
  NextObserver
} from 'rxjs'
import { filter } from 'rxjs/operators'

import { MqttClient as MQTTClient, IClientOptions as MQTTClientOptions, connect } from 'mqtt'
/**
 * WebSocketSubjectConfig is a plain Object that allows us to make our
 * webSocket configurable.
 *
 * <span class="informal">Provides flexibility to {@link webSocket}</span>
 *
 * It defines a set of properties to provide custom behavior in specific
 * moments of the socket's lifecycle. When the connection opens we can
 * use `openObserver`, when the connection is closed `closeObserver`, if we
 * are interested in listening for data comming from server: `deserializer`,
 * which allows us to customize the deserialization strategy of data before passing it
 * to the socket client. By default `deserializer` is going to apply `JSON.parse` to each message comming
 * from the Server.
 *
 * ## Example
 * **deserializer**, the default for this property is `JSON.parse` but since there are just two options
 * for incomming data, either be text or binarydata. We can apply a custom deserialization strategy
 * or just simply skip the default behaviour.
 * ```ts
 * import { webSocket } from 'rxjs/webSocket';
 *
 * const wsSubject = webSocket({
 *     url: 'ws://localhost:8081',
 * //Apply any transformation of your choice.
 *     deserializer: ({data}) => data
 * });
 *
 * wsSubject.subscribe(console.log);
 *
 * // Let's suppose we have this on the Server: ws.send("This is a msg from the server")
 * //output
 * //
 * // This is a msg from the server
 * ```
 *
 * **serializer** allows us tom apply custom serialization strategy but for the outgoing messages
 * ```ts
 * import { webSocket } from 'rxjs/webSocket';
 *
 * const wsSubject = webSocket({
 *     url: 'ws://localhost:8081',
 * //Apply any transformation of your choice.
 *     serializer: msg => JSON.stringify({channel: "webDevelopment", msg: msg})
 * });
 *
 * wsSubject.subscribe(() => subject.next("msg to the server"));
 *
 * // Let's suppose we have this on the Server: ws.send("This is a msg from the server")
 * //output
 * //
 * // {"channel":"webDevelopment","msg":"msg to the server"}
 * ```
 *
 * **closeObserver** allows us to set a custom error when an error raise up.
 * ```ts
 * import { webSocket } from 'rxjs/webSocket';
 *
 * const wsSubject = webSocket({
 *     url: 'ws://localhost:8081',
 *     closeObserver: {
        next(closeEvent) {
            const customError = { code: 6666, reason: "Custom evil reason" }
            console.log(`code: ${customError.code}, reason: ${customError.reason}`);
        }
    }
 * });
 *
 * //output
 * // code: 6666, reason: Custom evil reason
 * ```
 *
 * **openObserver**, Let's say we need to make some kind of init task before sending/receiving msgs to the
 * webSocket or sending notification that the connection was successful, this is when
 * openObserver is usefull for.
 * ```ts
 * import { webSocket } from 'rxjs/webSocket';
 *
 * const wsSubject = webSocket({
 *     url: 'ws://localhost:8081',
 *     openObserver: {
 *         next: () => {
 *             console.log('connetion ok');
 *         }
 *     },
 * });
 *
 * //output
 * // connetion ok`
 * ```
 * */

export interface MQTTSubjectConfig<T> {
  /** The url of the MQTT server to connect to */
  url: string
  /** The protocol to use to connect */
  options?: MQTTClientOptions
  /**
   * A serializer used to create messages from passed values before the
   * messages are sent to the server. Defaults to JSON.stringify.
   */
  serializer?: (value: T) => MQTTMessage
  /**
   * A deserializer used for messages arriving on the socket from the
   * server. Defaults to JSON.parse.
   */
  deserializer?: (e: MessageEvent) => T
  /**
   * An Observer that watches when open events occur on the underlying connection
   */
  connectObserver?: NextObserver<Event>
  /**
   * An Observer than watches when close events occur on the underlying connection
   */
  disconnectObserver?: NextObserver<CloseEvent>
  /**
   * An Observer that watches when a close is about to occur due to
   * unsubscription.
   */
  disconnectingObserver?: NextObserver<void>
}

const DEFAULT_MQTT_CONFIG: MQTTSubjectConfig<any> = {
  url: '',
  deserializer: (e: MessageEvent) => JSON.parse(e),
  serializer: (value: any) => JSON.stringify(value)
}

const WEBSOCKETSUBJECT_INVALID_ERROR_OBJECT =
  'WebSocketSubject.error must be called with an object with an error code, and an optional reason: { code: number, reason: string }'

export type MQTTMessage = string | ArrayBuffer | Blob | ArrayBufferView

export class MQTTSubject<T> extends AnonymousSubject<T> {
  private _config: MQTTSubjectConfig<T>

  /** @deprecated This is an internal implementation detail, do not use. */
  _output: Subject<T>

  private _connection: MQTTClient

  constructor(
    urlConfigOrSource: string | MQTTSubjectConfig<T> | Observable<T>,
    destination?: Observer<T>
  ) {
    super()
    if (urlConfigOrSource instanceof Observable) {
      this.destination = destination
      this.source = urlConfigOrSource as Observable<T>
    } else {
      const config = (this._config = { ...DEFAULT_MQTT_CONFIG })
      this._output = new Subject<T>()
      if (typeof urlConfigOrSource === 'string') {
        config.url = urlConfigOrSource
      } else {
        for (let key in urlConfigOrSource) {
          if (urlConfigOrSource.hasOwnProperty(key)) {
            config[key] = urlConfigOrSource[key]
          }
        }
      }

      this.destination = new ReplaySubject()
    }
  }

  lift<R>(operator: Operator<T, R>): MQTTSubject<R> {
    const sock = new MQTTSubject<R>(this._config as MQTTSubjectConfig<any>, <any>this.destination)
    sock.operator = operator
    sock.source = this
    return sock
  }

  private _resetState() {
    // FIX: resetting connection
    this._connection.end()
    // this._connection = null;
    if (!this.source) {
      this.destination = new ReplaySubject()
    }
    this._output = new Subject<T>()
  }

  topic(topic: string) {
    this._connection.subscribe(topic)
    return new MQTTTopicSubject(this, topic)
  }

  /**
   * Creates an {@link Observable}, that when subscribed to, sends a message,
   * defined by the `subMsg` function, to the server over the socket to begin a
   * subscription to data over that socket. Once data arrives, the
   * `messageFilter` argument will be used to select the appropriate data for
   * the resulting Observable. When teardown occurs, either due to
   * unsubscription, completion or error, a message defined by the `unsubMsg`
   * argument will be send to the server over the WebSocketSubject.
   *
   * @param subMsg A function to generate the subscription message to be sent to
   * the server. This will still be processed by the serializer in the
   * WebSocketSubject's config. (Which defaults to JSON serialization)
   * @param unsubMsg A function to generate the unsubscription message to be
   * sent to the server at teardown. This will still be processed by the
   * serializer in the WebSocketSubject's config.
   * @param messageFilter A predicate for selecting the appropriate messages
   * from the server for the output stream.
   */
  // multiplex(subMsg: () => any, unsubMsg: () => any, messageFilter: (value: T) => boolean) {
  //   const self = this;
  //   return new Observable((observer: Observer<any>) => {
  //     try {
  //       self.next(subMsg());
  //     } catch (err) {
  //       observer.error(err);
  //     }

  //     const subscription = self.subscribe(x => {
  //       try {
  //         if (messageFilter(x)) {
  //           observer.next(x);
  //         }
  //       } catch (err) {
  //         observer.error(err);
  //       }
  //     },
  //       err => observer.error(err),
  //       () => observer.complete());

  //     return () => {
  //       try {
  //         self.next(unsubMsg());
  //       } catch (err) {
  //         observer.error(err);
  //       }
  //       subscription.unsubscribe();
  //     };
  //   });
  // }

  private _connectBroker() {
    const { url, options } = this._config
    const observer = this._output

    let connection: MQTTClient | null = null
    try {
      connection = options
        ? connect(
            url,
            options
          )
        : connect(url)
      this._connection = connection
    } catch (e) {
      observer.error(e)
      return
    }

    // TODO: Review if this.reset is sufficient
    const subscription = new Subscription(() => {
      // this._connection = null;
      if (connection && connection.connected) {
        connection.end()
      }
    })

    connection.on('connect', e => {
      const { connectObserver } = this._config
      if (connectObserver) {
        connectObserver.next(e)
      }
      const queue = this.destination

      this.destination = Subscriber.create<T>(
        ({ topic, message }) => {
          if (connection.connected) {
            const { serializer } = this._config
            connection.publish(topic, serializer(message), undefined, (e: Error) =>
              this.destination.error(e)
            )
          }
        },
        e => {
          const { disconnectingObserver } = this._config
          if (disconnectingObserver) {
            disconnectingObserver.next(undefined)
          }
          this._resetState()
        },
        () => {
          const { disconnectingObserver } = this._config
          if (disconnectingObserver) {
            disconnectingObserver.next(undefined)
          }
          connection.end()
          this._resetState()
        }
      ) as Subscriber<any>

      if (queue && queue instanceof ReplaySubject) {
        subscription.add((<ReplaySubject<T>>queue).subscribe(this.destination))
      }
    })

    connection.on('error', e => {
      this._resetState()
      observer.error(e)
    })

    connection.stream.on('error', e => {
      this._resetState()
      observer.error(e)
    })

    connection.on('end', e => {
      this._resetState()
      const { disconnectObserver } = this._config
      if (disconnectObserver) {
        disconnectObserver.next(e)
      }
      observer.complete()
      // if (e.wasClean) {
      //   observer.complete();
      // } else {
      //   observer.error(e);
      // }
    })
    connection.on('message', (topic, messageBuffer) => {
      // TODO: Serialize/deserialize per topic
      try {
        const { deserializer } = this._config
        let message = messageBuffer.toString()
        observer.next({
          topic,
          message: deserializer(message)
        })
      } catch (err) {
        observer.error(err)
      }
    })
  }

  /** @deprecated This is an internal implementation detail, do not use. */
  _subscribe(subscriber: Subscriber<T>): Subscription {
    const { source } = this
    if (source) {
      return source.subscribe(subscriber)
    }
    if (!this._connection) {
      this._connectBroker()
    }
    this._output.subscribe(subscriber)
    subscriber.add(() => {
      const { _connection } = this
      if (this._output.observers.length === 0) {
        if (_connection && _connection.connected) {
          _connection.end()
        }
        this._resetState()
      }
    })
    return subscriber
  }

  unsubscribe() {
    const { _connection } = this
    if (_connection && _connection.connected) {
      _connection.end()
    }
    this._resetState()
    super.unsubscribe()
  }
}

export class MQTTTopicSubject<T> extends AnonymousSubject<T> {
  constructor(source: MQTTSubject<T>, private _topic: string) {
    super(source, source)
  }

  _subscribe(subscriber) {
    //FIXME: Actual subscribe should be executed here
    const { source } = this
    if (source) {
      return this.source.pipe(filter(packet => packet.topic === this._topic)).subscribe(subscriber)
    } else {
      return Subscription.EMPTY
    }
  }
}
