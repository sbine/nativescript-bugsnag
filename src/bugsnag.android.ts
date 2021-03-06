import { BaseNative, BREADCRUMB_MAX_LENGTH, ClientBase, clog, createGetter, createSetter, cwarn } from './bugsnag.common';
import { knownFolders } from 'tns-core-modules/file-system';
import * as application from 'tns-core-modules/application';
import { ConfigurationOptions, NativePropertyOptions } from './bugsnag';
const appPath = knownFolders.currentApp().path + '/';

export enum BreadcrumbType {
    ERROR = 'ERROR',
    LOG = 'LOG',
    MANUAL = 'MANUAL',
    NAVIGATION = 'NAVIGATION',
    PROCESS = 'PROCESS',
    REQUEST = 'REQUEST',
    STATE = 'STATE',
    USER = 'USER'
}

function nativePropertyGenerator(target: Object, key: string, options?: NativePropertyOptions) {
    // clog('mapPropertyGenerator', key, Object.keys(options));
    Object.defineProperty(target, key, {
        get: createGetter(key, options),
        set: createSetter(key, options),
        enumerable: true,
        configurable: true
    });
}

export function nativeProperty(target: any, k?, desc?: PropertyDescriptor): any;
export function nativeProperty(options: NativePropertyOptions): (target: any, k?, desc?: PropertyDescriptor) => any;
export function nativeProperty(...args) {
    // clog('test deco', typeof args[0], Object.keys(args[0]), args[1], typeof args[1]);
    if (args.length === 1) {
        /// this must be a factory
        return function(target: any, key?: string, descriptor?: PropertyDescriptor) {
            return nativePropertyGenerator(target, key, args[0] || {});
        };
    } else {
        const options = typeof args[1] === 'string' ? undefined : args[0];
        const startIndex = !!options ? 1 : 0;
        return nativePropertyGenerator(args[startIndex], args[startIndex + 1], options || {});
    }
}

function getBreadcrumbType(value: string | com.bugsnag.android.BreadcrumbType) {
    if (typeof value === 'string') {
        return com.bugsnag.android.BreadcrumbType.valueOf(value);
    }
    return value;
}
function getNativeHashMap(obj: { [k: string]: string }) {
    if (!obj) {
        return null;
    }
    const map = new java.util.HashMap<string, string>();
    Object.keys(obj).forEach(k => {
        map.put(k, obj[k]);
    });
    return map;
}

let JavaScriptException: JavaScriptException;

interface JavaScriptException extends java.lang.Exception {
    // tslint:disable-next-line: no-misused-new
    new (message): JavaScriptException;
    name;
    rawStacktrace;
}
function initJavaScriptException() {
    if (JavaScriptException) {
        return;
    }

    const stackTraceRegex = /at\s*?([^\(]*)?\s*\(?(?:file:\/\/|\/webpack:)([^:\n]*)(?::([0-9]+))?(?::([0-9]+))?\)?/g;

    // @JavaProxy('com.nativescript.bugsnag.JavascriptException')
    @Interfaces([com.bugsnag.android.JsonStream.Streamable])
    class JavaScriptExceptionImpl extends java.lang.Exception implements com.bugsnag.android.JsonStream.Streamable {
        private EXCEPTION_TYPE = 'JS';
        private serialVersionUID = 1175784680140218622;
        name: string;
        rawStacktrace: string;

        constructor(message) {
            super(message);
            // this.rawStacktrace = rawStacktrace;
        }

        toStream(writer: com.bugsnag.android.JsonStream) {
            writer.beginObject();
            writer.name('errorClass').value(this.name);
            writer.name('message').value(this.getLocalizedMessage());
            writer.name('type').value(this.EXCEPTION_TYPE);
            // clog('toStream', appPath, this.rawStacktrace);
            if (this.rawStacktrace) {
                writer.name('stacktrace');
                writer.beginArray();
                let match = stackTraceRegex.exec(this.rawStacktrace);
                // clog('toStream', 'rawStacktrace', this.rawStacktrace, match);
                while (match != null) {
                    writer.beginObject();
                    if (match[1]) {
                        writer.name('method').value(match[1]);
                    }
                    writer.name('columnNumber').value(parseInt(match[4], 10));
                    writer.name('lineNumber').value(parseInt(match[3], 10));
                    if (match[2]) {
                        writer.name('file').value(match[2].replace(appPath, ''));
                    }
                    writer.endObject();
                    // matched text: match[0]
                    // match start: match.index
                    // capturing group n: match[n]
                    // clog('adding stacktrace:');
                    // clog('   method:', match[1]);
                    // clog('   columnNumber:', match[4], parseInt(match[4], 10));
                    // clog('   lineNumber:', match[3], parseInt(match[3], 10));
                    // clog('   file:', match[2], match[2].replace(appPath, ''));
                    match = stackTraceRegex.exec(this.rawStacktrace);
                }
                writer.endArray();
            }
            writer.endObject();
        }
    }
    JavaScriptException = JavaScriptExceptionImpl as any;
}

let DiagnosticsCallback: DiagnosticsCallback;

type DiagnosticsCallback = new (libraryVersion, bugsnagAndroidVersion, payload) => com.bugsnag.android.Callback;
function initDiagnosticsCallback() {
    if (DiagnosticsCallback) {
        return;
    }
    @Interfaces([com.bugsnag.android.Callback])
    class DiagnosticsCallbackImpl extends java.lang.Object implements com.bugsnag.android.Callback {
        static NOTIFIER_NAME = 'Bugsnag for NativeScript';
        static NOTIFIER_URL = 'https://github.com/Akylas/nativescript-bugsnag';

        private severity;
        private context;
        private groupingHash;
        private metadata;

        constructor(private libraryVersion, private bugsnagAndroidVersion, private payload) {
            super();
            this.severity = this.parseSeverity(payload.severity);
            this.metadata = payload.metadata;
            this.context = payload.context || null;
            this.groupingHash = payload.groupingHash || null;
        }

        parseSeverity(value) {
            switch (value) {
                case 'error':
                    return com.bugsnag.android.Severity.ERROR;
                case 'info':
                    return com.bugsnag.android.Severity.INFO;
                case 'warning':
                default:
                    return com.bugsnag.android.Severity.WARNING;
            }
        }

        beforeNotify(report: com.bugsnag.android.Report) {
            report.getNotifier().setName(DiagnosticsCallbackImpl.NOTIFIER_NAME);
            report.getNotifier().setURL(DiagnosticsCallbackImpl.NOTIFIER_URL);
            report.getNotifier().setVersion(`${this.libraryVersion} (Android ${this.bugsnagAndroidVersion})`);

            if (this.groupingHash && this.groupingHash.length > 0) report.getError().setGroupingHash(this.groupingHash);
            if (this.context && this.context.length > 0) report.getError().setContext(this.context);
            if (this.metadata) {
                const reportMetadata = report.getError().getMetaData();
                Object.keys(this.metadata).forEach(tab => {
                    const values = this.metadata[tab];
                    if (typeof values === 'object') {
                        Object.keys(values).forEach(key => {
                            reportMetadata.addToTab(tab, key, values[key]);
                        });
                    }
                });
                // for (String tab : this.metadata.keySet()) {
                //     Object value = metadata.get(tab);

                //     if (value instanceof Map) {
                //         @SuppressWarnings("unchecked") // ignore type erasure when casting Map
                //         Map<String, Object> values = (Map<String, Object>) value;

                //         for (String key : values.keySet()) {
                //             reportMetadata.addToTab(tab, key, values.get(key));
                //         }
                //     }
                // }
            }
        }
    }
    DiagnosticsCallback = DiagnosticsCallbackImpl as any;
}

export class Client extends ClientBase {
    _client: com.bugsnag.android.Client;
    libraryVersion;
    bugsnagAndroidVersion;

    getBreadcrumbType(str: string) {
        return getBreadcrumbType(str);
    }
    runInit() {
        const currentContext = application.android.context as android.content.Context;
        // clog('Bugnsag', 'runInit1', currentContext);
        if (currentContext) {
            this._client = com.bugsnag.android.Bugsnag.init(currentContext, this.config.getNative());

            // const array = Array.create('java.lang.String', 1);
            // array[0] = 'com.nativescript.bugsnag.JavascriptException';
            // this._client.setIgnoreClasses(array);
            // clog('client setIgnoreClasses');
            this.libraryVersion = require('./package.json').version;
            this.bugsnagAndroidVersion = (this._client as any) // java.lang.Object
                .getClass()
                .getPackage()
                .getSpecificationVersion();
            // clog('Bugnsag', 'did init', this.libraryVersion, this.bugsnagAndroidVersion);
        }
    }
    init(conf: Configuration | ConfigurationOptions | string): Promise<any> {
        // clog('Bugnsag', 'init', conf, !!this._client, knownFolders.currentApp().path, application.launchEvent);
        if (!this._client) {
            this.config = conf instanceof Configuration ? conf : new Configuration(typeof conf === 'object' ? conf : { apiKey: conf });
            return new Promise((resolve, reject) => {
                const onLaunched = () => {
                    try {
                        // clog('Bugnsag', 'onLaunched');
                        application.off(application.launchEvent, onLaunched);
                        this.runInit();
                        resolve(this._client);
                    } catch (ex) {
                        clog('Error in Bugsnag.init: ' + ex);
                        reject(ex);
                    }
                };
                // clog('Bugnsag', 'will init', !!application.android.nativeApp, !!application.android.context, !!application.android.startActivity);

                if (application.android.nativeApp) {
                    onLaunched();
                } else {
                    // console.log('Bugnsag', 'will init on launchEvent');
                    application.on(application.launchEvent, onLaunched);
                }
            });
        }
        return Promise.resolve(this._client);
        // return !!this._client;
    }
    leaveBreadcrumb(message: string, type?: any, metaData?: { [k: string]: string }) {
        if (this._client) {
            if (message.length > BREADCRUMB_MAX_LENGTH) {
                cwarn(`Breadcrumb name exceeds ${BREADCRUMB_MAX_LENGTH} characters (it has ${message.length}): ${name}. It will be truncated.`);
            }
            if (type || metaData) {
                this._client.leaveBreadcrumb(message, getBreadcrumbType(type), getNativeHashMap(metaData));
            } else {
                this._client.leaveBreadcrumb(message);
            }
        }
    }
    setUser(id: string, email: string, name: string) {
        if (this._client) {
            this._client.setUser(id, email, name);
        }
    }
    setUserId(id: string) {
        if (this._client) {
            this._client.setUserId(id);
        }
    }
    setUserEmail(email: string) {
        if (this._client) {
            this._client.setUserEmail(email);
        }
    }
    setUserName(name: string) {
        if (this._client) {
            this._client.setUserName(name);
        }
    }
    startSession() {
        if (this._client) {
            this._client.startSession();
        }
    }
    stopSession() {
        if (this._client) {
            this._client.stopSession();
        }
    }
    resumeSession() {
        if (this._client) {
            this._client.resumeSession();
        }
    }
    /**
     * Clear custom user data and reset to the default device identifier
     */
    clearUser() {
        if (this._client) {
            this._client.clearUser();
        }
    }
    // leaveBreadcrumb(name: string, type: BreadcrumbType, metaData?: { [k: string]: string }) {
    //     if (this._client) {
    //         clog('about to leaveBreadcrumb client', message);
    //         this._client.leaveBreadcrumb(message);
    //     }
    // }
    handleNotify(options) {
        if (this._client) {
            const errorClass = options.errorClass;
            const errorMessage = options.errorMessage;
            const rawStacktrace = options.stacktrace;
            initJavaScriptException();
            const exc = new JavaScriptException(errorMessage);
            exc.name = errorClass;
            exc.rawStacktrace = rawStacktrace;
            // clog('handleNotify', exc, exc.rawStacktrace);

            initDiagnosticsCallback();
            const handler = new DiagnosticsCallback(this.libraryVersion, this.bugsnagAndroidVersion, options);

            const map = new java.util.HashMap();
            //   String severity = payload.getString("severity");
            //   String severityReason = payload.getString("severityReason");
            map.put('severity', options.severity);
            map.put('severityReason', options.severityReason);
            com.bugsnag.android.Bugsnag.internalClientNotify(exc, map, !!options.blocking, handler);
            return Promise.resolve(true);
        }
        return Promise.reject('not_initialized');
    }
}

function onBeforeNotifyError(error: com.bugsnag.android.Error) {

    if (error.getExceptionName() === 'com.tns.NativeScriptException') {
        return false;
    }
    clog('onBeforeNotifyError', error.getExceptionName(), error.getExceptionMessage(), error.getGroupingHash(), error.getDeviceData(), error.getSeverity().getName(), error.getContext());
    return true;
}

export class Configuration extends BaseNative<com.bugsnag.android.Configuration, ConfigurationOptions> {
    apiKey: string;
    autoNotify: boolean = true;
    notifyReleaseStages: string[];
    @nativeProperty sendThreads: boolean;
    @nativeProperty({
        nativeGetterName: 'shouldAutoCaptureSessions'
    })
    autoCaptureSessions: boolean;
    @nativeProperty detectAnrs: boolean;
    @nativeProperty enableExceptionHandler: boolean;
    @nativeProperty appVersion: string;
    @nativeProperty buildUUID: string;
    @nativeProperty sessionEndpoint: string;
    @nativeProperty endpoint: string;
    @nativeProperty codeBundleId: string;
    @nativeProperty releaseStage: string;
    @nativeProperty context: string;
    @nativeProperty anrThresholdMs: number;
    @nativeProperty launchCrashThresholdMs: number;
    @nativeProperty maxBreadcrumbs: number;
    @nativeProperty notifierType: string;
    @nativeProperty persistUserBetweenSessions: boolean;
    @nativeProperty({
        nativeSetterName: 'shouldIgnoreClass'
    })
    ignoreClasses: boolean;
    @nativeProperty({
        nativeSetterName: 'shouldNotifyForReleaseStage'
    })
    notifyForReleaseStage: boolean;
    @nativeProperty({
        nativeGetterName: 'isAutomaticallyCollectingBreadcrumbs'
    })
    automaticallyCollectBreadcrumbs: boolean;

    createNative(options?: ConfigurationOptions) {
        clog('Configuration', 'createNative', options);
        const result = new com.bugsnag.android.Configuration(options.apiKey);
        result.beforeNotify(
            new com.bugsnag.android.BeforeNotify({
                run: onBeforeNotifyError
            })
        );
        return result;
    }

    set beforeSend(callback) {
        this.getNative().beforeSend(
            new com.bugsnag.android.BeforeSend({
                run(report) {
                    return callback(report);
                }
            })
        );
    }
    /**
     * Whether reports should be sent to Bugsnag, based on the release stage
     * configuration
     */
    shouldNotify() {
        return !this.options.releaseStage || !this.options.notifyReleaseStages || this.options.notifyReleaseStages.indexOf(this.options.releaseStage) !== -1;
    }
    // public getMetaData(): com.bugsnag.android.MetaData;
    // public setMetaData(param0: com.bugsnag.android.MetaData): void;
    // public inProject(param0: string): boolean;
    // public beforeSend(param0: com.bugsnag.android.BeforeSend): void;
    // public getBeforeSendTasks(): java.util.Collection<com.bugsnag.android.BeforeSend>;
    // public beforeNotify(param0: com.bugsnag.android.BeforeNotify): void;
    // public update(param0: java.util.Observable, param1: any): void;
    // public setDelivery(param0: com.bugsnag.android.Delivery): void;
    // public getNotifyReleaseStages(): native.Array<string>;
    // public getProjectPackages(): native.Array<string>;
    // public getIgnoreClasses(): native.Array<string>;
    // public setProjectPackages(param0: native.Array<string>): void;
    // public getBeforeRecordBreadcrumbTasks(): java.util.Collection<com.bugsnag.android.BeforeRecordBreadcrumb>;
    // public getDelivery(): com.bugsnag.android.Delivery;
    // public getMaxBreadcrumbs(): number;
    // public setFilters(param0: native.Array<string>): void;
    // public setEndpoints(param0: string, param1: string): void;
    // public getFilters(): native.Array<string>;
    // public getBeforeNotifyTasks(): java.util.Collection<com.bugsnag.android.BeforeNotify>;
    // public setIgnoreClasses(param0: native.Array<string>): void;
    // public setNotifyReleaseStages(param0: native.Array<string>): void;
    // public getErrorApiHeaders(): java.util.Map<string, string>;
    // public getSessionApiHeaders(): java.util.Map<string, string>;
    // public beforeRecordBreadcrumb(param0: com.bugsnag.android.BeforeRecordBreadcrumb): void;
}
