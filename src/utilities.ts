import * as vscode from 'vscode';
const specialWords = ['-', '+', '/', '*']; //TODO: Add more here
import * as _ from 'lodash';
import * as state from './state';
import * as path from 'path';
const syntaxQuoteSymbol = "`";
import select from './select';
import * as outputWindow from './results-output/results-doc';
import * as docMirror from './doc-mirror';

export function stripAnsi(str: string) {
    return str.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g, "")
}

async function quickPickSingle(opts: { values: string[], saveAs?: string, placeHolder: string, autoSelect?: boolean }) {
    if (opts.values.length == 0)
        return;
    let selected: string;
    let saveAs: string = opts.saveAs ? `qps-${opts.saveAs}` : null;
    if (saveAs) {
        selected = state.extensionContext.workspaceState.get(saveAs);
    }

    let result;
    if (opts.autoSelect && opts.values.length == 1)
        result = opts.values[0];
    else
        result = await quickPick(opts.values, selected ? [selected] : [], [], { placeHolder: opts.placeHolder, ignoreFocusOut: true })
    state.extensionContext.workspaceState.update(saveAs, result);
    return result;
}

async function quickPickMulti(opts: { values: string[], saveAs?: string, placeHolder: string }) {
    let selected: string[];
    let saveAs: string = opts.saveAs ? `qps-${opts.saveAs}` : null;
    if (saveAs) {
        selected = state.extensionContext.workspaceState.get(saveAs) || [];
    }
    let result = await quickPick(opts.values, [], selected, { placeHolder: opts.placeHolder, canPickMany: true, ignoreFocusOut: true })
    state.extensionContext.workspaceState.update(saveAs, result);
    return result;
}

function quickPick(itemsToPick: string[], active: string[], selected: string[], options: vscode.QuickPickOptions & { canPickMany: true }): Promise<string[]>;
function quickPick(itemsToPick: string[], active: string[], selected: string[], options: vscode.QuickPickOptions): Promise<string>;

async function quickPick(itemsToPick: string[], active: string[], selected: string[], options: vscode.QuickPickOptions): Promise<string | string[]> {
    let items = itemsToPick.map(x => ({ label: x }));

    let qp = vscode.window.createQuickPick();
    qp.canSelectMany = options.canPickMany;
    qp.placeholder = options.placeHolder;
    qp.ignoreFocusOut = options.ignoreFocusOut;
    qp.matchOnDescription = options.matchOnDescription
    qp.matchOnDetail = options.matchOnDetail
    qp.items = items;
    qp.activeItems = items.filter(x => active.indexOf(x.label) != -1);
    qp.selectedItems = items.filter(x => selected.indexOf(x.label) != -1);
    return new Promise<string[] | string>((resolve, reject) => {
        qp.show();
        qp.onDidAccept(() => {
            if (qp.canSelectMany)
                resolve(qp.selectedItems.map(x => x.label))
            else if (qp.selectedItems.length)
                resolve(qp.selectedItems[0].label)
            else
                resolve(undefined);
            qp.hide();
        })
        qp.onDidHide(() => {
            resolve([]);
            qp.hide();
        })
    })
}

function getCljsReplStartCode() {
    return vscode.workspace.getConfiguration('calva').startCLJSREPLCommand;
}

function getShadowCljsReplStartCode(build) {
    return '(shadow.cljs.devtools.api/nrepl-select ' + build + ')';
}

function getTestUnderCursor() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const document = editor.document;
        const startPositionOfTopLevelForm = select.getFormSelection(document, editor.selection.active, true).start;
        const cursorOffset = editor.document.offsetAt(startPositionOfTopLevelForm);
        const tokenCursor = docMirror.getDocument(editor.document).getTokenCursor(cursorOffset);
        while (tokenCursor.downList()) {
            tokenCursor.forwardWhitespace();
            if (['def', 'defn', 'deftest'].includes(tokenCursor.getToken().raw)) {
                tokenCursor.forwardSexp();
                tokenCursor.forwardWhitespace();
                return tokenCursor.getToken().raw;
            } else {
                tokenCursor.forwardSexp();
                tokenCursor.forwardWhitespace();
            }
        }
    }
    return undefined;
}

function getStartExpression(text) {
    let match = text.match(/^\(([^\)]+)[\)]+/g);
    return match ? match[0] : "(ns user)";
}

function getActualWord(document, position, selected, word) {
    if (selected === undefined) {
        let selectedChar = document.lineAt(position.line).text.slice(position.character, position.character + 1),
            isFn = document.lineAt(position.line).text.slice(position.character - 1, position.character) === "(";
        if (selectedChar !== undefined &&
            specialWords.indexOf(selectedChar) !== -1 &&
            isFn) {
            return selectedChar;
        } else {
            return "";
        }
    } else {
        return (word && word.startsWith(syntaxQuoteSymbol)) ? word.substr(1) : word;
    }
}

function getWordAtPosition(document, position) {
    let selected = document.getWordRangeAtPosition(position),
        selectedText = selected !== undefined ? document.getText(new vscode.Range(selected.start, selected.end)) : "",
        text = getActualWord(document, position, selected, selectedText);
    return text;
}

function getDocument(document): vscode.TextDocument {
    if (document && document.hasOwnProperty('fileName')) {
        return document;
    } else if (vscode.window.activeTextEditor) {
        return vscode.window.activeTextEditor.document;
    } else if (vscode.window.visibleTextEditors.length > 0) {
        return vscode.window.visibleTextEditors[0].document;
    } else {
        return null;
    }
}

function getFileType(document) {
    let doc = getDocument(document);

    if (doc) {
        return path.extname(doc.fileName).replace(/^\./, "");
    }
    else {
        return 'clj';
    }
}

function getFileName(document) {
    return path.basename(document.fileName);
}

function getLaunchingState() {
    return state.deref().get('launching');
}

function setLaunchingState(value: any) {
    vscode.commands.executeCommand("setContext", "calva:launching", Boolean(value));
    state.cursor.set('launching', value);
}

function getConnectedState() {
    return state.deref().get('connected');
}

function setConnectedState(value: Boolean) {
    vscode.commands.executeCommand("setContext", "calva:connected", value);
    state.cursor.set('connected', value);
}

function getConnectingState() {
    return state.deref().get('connecting');
}

function setConnectingState(value: Boolean) {
    if (value) {
        vscode.commands.executeCommand("setContext", "calva:connecting", true);
        state.cursor.set('connecting', true);
    } else {
        vscode.commands.executeCommand("setContext", "calva:connecting", false);
        state.cursor.set('connecting', false);
    }
}

// ERROR HELPERS
const ERROR_TYPE = {
    WARNING: "warning",
    ERROR: "error"
};

function logSuccess(results) {
    let chan = state.outputChannel();
    chan.appendLine("Evaluation completed successfully");
    _.each(results, (r) => {
        let value = r.hasOwnProperty("value") ? r.value : null;
        let out = r.hasOwnProperty("out") ? r.out : null;
        if (value !== null) {
            chan.appendLine("=>\n" + value);
        }
        if (out !== null) {
            chan.appendLine("out:\n" + out);
        }
    });
}

function logError(error) {
    outputWindow.append('; ' + error.reason);
    if (error.line !== undefined && error.line !== null &&
        error.column !== undefined && error.column !== null) {
        outputWindow.append(";   at line: " + error.line + " and column: " + error.column)
    }
}

function markError(error) {
    if (error.line === null) {
        error.line = 0;
    }
    if (error.column === null) {
        error.column = 0;
    }

    let diagnostic = state.deref().get('diagnosticCollection'),
        editor = vscode.window.activeTextEditor;

    //editor.selection = new vscode.Selection(position, position);
    let line = error.line - 1,
        column = error.column,
        lineLength = editor.document.lineAt(line).text.length,
        lineText = editor.document.lineAt(line).text.substring(column, lineLength),
        firstWordStart = column + lineText.indexOf(" "),
        existing = diagnostic.get(editor.document.uri),
        err = new vscode.Diagnostic(new vscode.Range(line, column, line, firstWordStart),
            error.reason,
            vscode.DiagnosticSeverity.Error);

    let errors = (existing !== undefined && existing.length > 0) ? [...existing, err] :
        [err];
    diagnostic.set(editor.document.uri, errors);
}

function logWarning(warning) {
    outputWindow.append('; ' + warning.reason);
    if (warning.line !== null) {
        if (warning.column !== null) {
            outputWindow.append(";   at line: " + warning.line + " and column: " + warning.column)
        } else {
            outputWindow.append(";   at line: " + warning.line)
        }
    }
}

function markWarning(warning) {
    if (warning.line === null) {
        warning.line = 0;
    }
    if (warning.column === null) {
        warning.column = 0;
    }

    let diagnostic = state.deref().get('diagnosticCollection'),
        editor = vscode.window.activeTextEditor;

    //editor.selection = new vscode.Selection(position, position);
    let line = Math.max(0, (warning.line - 1)),
        column = warning.column,
        lineLength = editor.document.lineAt(line).text.length,
        existing = diagnostic.get(editor.document.uri),
        warn = new vscode.Diagnostic(new vscode.Range(line, column, line, lineLength),
            warning.reason,
            vscode.DiagnosticSeverity.Warning);

    let warnings = (existing !== undefined && existing.length > 0) ? [...existing, warn] :
        [warn];
    diagnostic.set(editor.document.uri, warnings);
}

async function promptForUserInputString(prompt: string): Promise<string> {
    return vscode.window.showInputBox({
        prompt: prompt,
        ignoreFocusOut: true,
    });
}

function debounce(func, wait, immediate) {
    var timeout;
    return function () {
        var context = this, args = arguments;
        var later = function () {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
};

function filterVisibleRanges(editor: vscode.TextEditor, ranges: vscode.Range[], combine = true): vscode.Range[] {
    let filtered: vscode.Range[] = [];
    editor.visibleRanges.forEach(visibleRange => {
        const visibles = ranges.filter(r => {
            return visibleRange.contains(r.start) || visibleRange.contains(r.end) || r.contains(visibleRange);
        });
        filtered = [].concat(filtered, combine ? [new vscode.Range(visibles[0].start, visibles[visibles.length - 1].end)] : visibles);
    });
    return filtered;
}

function scrollToBottom(editor: vscode.TextEditor) {
    const lastPos = editor.document.positionAt(Infinity);
    editor.selection = new vscode.Selection(lastPos, lastPos);
    editor.revealRange(new vscode.Range(lastPos, lastPos));
}

export {
    getStartExpression,
    getWordAtPosition,
    getDocument,
    getFileType,
    getFileName,
    getLaunchingState,
    setLaunchingState,
    getConnectedState,
    setConnectedState,
    getConnectingState,
    setConnectingState,
    specialWords,
    ERROR_TYPE,
    logError,
    markError,
    logWarning,
    markWarning,
    logSuccess,
    getCljsReplStartCode,
    getShadowCljsReplStartCode,
    quickPick,
    quickPickSingle,
    quickPickMulti,
    getTestUnderCursor,
    promptForUserInputString,
    debounce,
    filterVisibleRanges,
    scrollToBottom
};