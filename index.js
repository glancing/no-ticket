const esprima = require("esprima")
const fetch = require("node-fetch")
const fs = require("fs")

function convertKeArrayToKey(expansionArray) {
    function convertFrom32(int32) {
        let out = [];
        for (let i = 0; i < int32.length; i++) {
            let int = int32[i];
            out.push((256 + (int >> 24)) % 256);
            out.push((256 + (int << 8 >> 24)) % 256);
            out.push((256 + (int << 16 >> 24)) % 256);
            out.push((256 + (int << 24 >> 24)) % 256);
        }
        return out;
    }

    let key32 = [];
    for (let i = 0; i < 2; i++) {
        for (let j = 0; j < expansionArray[i].length; j++) {
            key32.push(expansionArray[i][j]);
        }
    }

    let newKey = convertFrom32(key32);

    return newKey;
}

const fetchScript = async url => {
    const contents = await fetch(url)
    return contents.text()
}

const isReturnStatement = node => {
    return (
        node.type === "ReturnStatement" &&
        node.argument &&
        node.argument.type &&
        node.argument.type === "SequenceExpression"
    )
}

const correctReturn = node => {
    return (
        node.argument &&
        node.argument.type === "SequenceExpression" &&
        node.argument.expressions &&
        node.argument.expressions.length == 3 &&
        node.argument.expressions[0].type === "AssignmentExpression"
    )
}

const isEncryptionFunction = node => {
    return (
        node.argument.expressions[0].left && 
        node.argument.expressions[0].left.type === "Identifier"
    )
}

const isExpression = node => {
    return (
        node.type &&
        node.type === "ExpressionStatement" &&
        node.expression &&
        node.expression.type === "SequenceExpression" &&
        node.expression.expressions && 
        node.expression.expressions.length > 1
    )
}

const isXor = node => {
    return (
        node.right &&
        node.right.type &&
        node.right.type === "BinaryExpression" &&
        node.right.operator &&
        node.right.operator === "^"
    )
}

const isSpecialRound = node => {
    return (
        node.expression &&
        node.expression.expressions &&
        node.expression.expressions.length == 4
    )
}

const getMessage = script => {
    const messageObj = {}
    esprima.parseScript(script, {}, (node, meta) => {
        if(isReturnStatement(node)){
            if(correctReturn(node)){
                if(isEncryptionFunction(node)){
                    if(node.argument.expressions[1].type === "AssignmentExpression"){
                        messageObj.name = node.argument.expressions[0].right.arguments[0].name
                        messageObj.start = meta.start.offset
                        messageObj.end = meta.end.offset
                    }
                }
            }
        }
    })
    return messageObj
}

const getFirstRound = script => {
    let roundKeys = []
    esprima.parseScript(script, { range: true }, (node, meta) => {
        if(isExpression(node)){
            if(isSpecialRound(node)){
                //console.log(node)
                node.expression.expressions.forEach(node => {
                    if(isXor(node)){
                        //console.log(node.right.left.range)
                        if(node.right.left.left){
                            roundKeys.push(script.substring(node.right.left.left.range[0], node.right.left.left.range[1]))
                            //console.log(script.substring(node.right.left.left.range[0], node.right.left.left.range[1]))
                        }
                        if(node.right.left.argument){
                            if(node.right.left.argument.left){
                                let operator = node.right.left.operator
                                if(!script.substring(node.right.left.argument.range[0], node.right.left.argument.range[1]).includes("+") || !script.substring(node.right.left.argument.range[0], node.right.left.argument.range[1]).includes('-')){
                                    if(operator){
                                        roundKeys.push(operator + node.right.left.argument.left.name)
                                    } else {
                                        roundKeys.push(node.right.left.argument.left.name)
                                    }
                                } else {
                                    roundKeys.push(script.substring(node.right.left.argument.range[0], node.right.left.argument.range[1]))
                                }
                            } 
                            if(node.right.left.argument.name){
                                roundKeys.push(script.substring(node.right.left.range[0], node.right.left.range[1]))
                                //console.log(node.right.left.argument.name)
                            } 
                            if(node.right.left.argument.argument){
                                //console.log(node.right.left.argument)
                                roundKeys.push(script.substring(node.right.left.range[0], node.right.left.range[1]))
                            }                           
                        } else {
                            if(node.right.left.name){
                                roundKeys.push(script.substring(node.right.left.range[0], node.right.left.range[1]))
                                //console.log(node.right.left.name)
                            }
                        }
                    }
                })
            }
        }
    })
    let result = []
    for(let i = 0; i < 4; i++){
        result.push(roundKeys[i])
    }
    //console.log(result)
    return result
}


const getFirstRoundValues = (script, vars) => {
    let lastRound = {}
    let cleanVars = []
    for(let i = 0; i < vars.length; i++){
        let elem = vars[i]
        elem = elem.replace("+", "")
        elem = elem.replace("-", "")
        elem = elem.replace(" ", "")
        cleanVars.push(elem)
    }
    esprima.parseScript(script, { range: false }, (node, meta) => {
        if(node.type === "AssignmentExpression"){
            if(node.left){
                if(cleanVars.includes(node.left.name)){
                    if(node.right && node.right.value.toString().length > 1){
                        lastRound[node.left.name] = node.right.value.toString()
                        //console.log(node.left.name, node.right.value.toString())
                    }
                }
            }
        }
        if(node.type === "VariableDeclarator"){
            if(node.id && node.id.type === "Identifier"){
                if(cleanVars.includes(node.id.name)){
                    if(node.init.value.toString().length > 0){
                        lastRound[node.id.name] = node.init.value.toString()
                        //console.log(node.id.name, node.init.value.toString())
                    } 
                }
            }
        }
    })
    return lastRound
}

const isBigSwitch = node => {
    return (
        node.type === "SequenceExpression" &&
        node.expressions && 
        node.expressions.length > 50
    )
}

const isRound = node => {
    return (
        node.type === "AssignmentExpression" &&
        node.right && 
        node.right.operator &&
        node.right.operator === "^" &&
        node.right.right &&
        node.right.right 
    )
}

const getMainRounds = script => {
    let roundKeys = []
    esprima.parseScript(script, { range: true }, (node, meta) => {
        if(isBigSwitch(node)){
            node.expressions.forEach(node => {
                if(isRound(node)){
                    //console.log(node.right.right)
                    if(node.right.right.type === "UnaryExpression"){
                        if(node.right.right.operator){
                            let operator = node.right.right.operator
                            if(node.right.right.argument){
                                if(node.right.right.argument.left){
                                    if(node.right.right.argument.left.name){
                                        if(operator){
                                            roundKeys.push(operator + node.right.right.argument.left.name)
                                        } else {
                                            roundKeys.push(node.right.right.argument.left.name)
                                        }
                                    }
                                } else {
                                    if(node.right.right.argument){
                                        let operator = node.right.right.operator
                                        if(operator){
                                            roundKeys.push(operator + script.substring(node.right.right.argument.range[0], node.right.right.argument.range[1]))
                                            //console.log(script.substring(node.right.right.argument.range[0], node.right.right.argument.range[1]))    
                                        } else {
                                            roundKeys.push(script.substring(node.right.right.argument.range[0], node.right.right.argument.range[1]))
                                        }
                                    }
                                }
                            }
                        } else {

                        }
                    }
                    if(node.right.right.type === "Identifier"){
                        roundKeys.push(script.substring(node.right.right.range[0], node.right.right.range[1]))
                        //console.log(script.substring())
                        //roundKeys
                    }
                    if(node.right.right.type === "BinaryExpression"){
                        if(node.right.right.left){
                            roundKeys.push(script.substring(node.right.right.left.range[0], node.right.right.left.range[1]))                        
                        }
                    }
                }
            })
        }
    })
    let result = []
    for(let i = 0; i < 52; i++){
        result.push(roundKeys[i])
    }
    return result
}

const getMainRoundsValues = (script, vars) => {
    let lastRound = {}
    let cleanVars = []
    for(let i = 0; i < vars.length; i++){
        let elem = vars[i]
        elem = elem.replace("+", "")
        elem = elem.replace("-", "")
        elem = elem.replace(" ", "")
        cleanVars.push(elem)
    }
    esprima.parseScript(script, { range: false }, (node, meta) => {
        if(node.type === "VariableDeclarator"){
            if(node.id && node.id.type === "Identifier"){
                if(cleanVars.includes(node.id.name)){
                    if(node.init.value.toString().length > 0){
                        if(!lastRound[node.id.name]){
                            lastRound[node.id.name] = node.init.value.toString()
                        }
                        //console.log(node.id.name, node.init.value.toString())
                    } 
                }
            }
        }
        if(node.type === "AssignmentExpression"){
            if(node.left){
                if(cleanVars.includes(node.left.name)){
                    if(node.right && node.right.value.toString().length > 1){
                        lastRound[node.left.name] = node.right.value.toString()
                        //console.log(node.left.name, node.right.value.toString())
                    }
                }
            }
        }
    })
    //console.log(lastRound)
    return lastRound
}

const isLastRound = node => {
    return (
        node.type === "AssignmentExpression" &&
        node.right && 
        node.right.operator &&
        node.right.operator === "&" &&
        node.right.right &&
        node.right.right 
    )
}

const getLastRounds = (script) => {
    let possibleKeys = []
    esprima.parseScript(script, { range: true }, (node, meta) => {
        if(isBigSwitch(node)){
            node.expressions.forEach(node => {
                if(isLastRound(node)){
                    if(node.right.right.operator === "^"){
                        possibleKeys.push(node.right.right.left)
                    }
                }
            })
        }
    })
    return possibleKeys
}

const checkLastRounds = (script, array) => {
    let values = []
    for(let i = 3; i < 16; i+=4){
        let node = array[i]
        if(node.type === "UnaryExpression"){
            let operator = node.operator
            if(node.argument){
                if(node.argument.left && node.argument.left.type === 'Identifier'){
                    if(operator){
                        values.push(operator + node.argument.left.name)
                    } else {
                        values.push(node.argument.left.name)
                    }
                } else {
                    if(operator){
                        values.push(operator + script.substring(node.argument.range[0], node.argument.range[1]))
                    } else {
                        values.push(script.substring(node.argument.range[0], node.argument.range[1]))
                    }

                }

            }
        }
        if(node.type === "Identifier"){
            values.push(node.name)
        }
        if(node.type === "BinaryExpression"){
            if(node.left){
                if(node.left.type === "Identifier"){
                    values.push(node.left.name)
                }
            }
        }
    }
    return values
}

const getLastRoundValues = (script, vars) => {
    let lastRound = {}
    let cleanVars = []
    for(let i = 0; i < vars.length; i++){
        let elem = vars[i]
        elem = elem.replace("+", "")
        elem = elem.replace("-", "")
        elem = elem.replace(" ", "")
        cleanVars.push(elem)
    }
    esprima.parseScript(script, { range: false }, (node, meta) => {
        if(node.type === "VariableDeclarator"){
            if(node.id && node.id.type === "Identifier"){
                if(cleanVars.includes(node.id.name)){
                    if(node.init.value.toString().length > 0){
                        if(!lastRound[node.id.name]){
                            lastRound[node.id.name] = node.init.value.toString()
                        }
                        //console.log(node.id.name, node.init.value.toString())
                    } 
                }
            }
        }
        if(node.type === "AssignmentExpression"){
            if(node.left){
                if(cleanVars.includes(node.left.name)){
                    if(node.right && node.right.value.toString().length > 1){
                        lastRound[node.left.name] = node.right.value.toString()
                        //console.log(node.left.name, node.right.value.toString())
                    }
                }
            }
        }
    })
    return lastRound
}

async function start(){
    const script = await fetchScript("https://www.supremenewyork.com/ticket.js")
    let encryptionKey = []

    //const script = fs.readFileSync("./eu-ticket.js", "utf-8")
    const message = getMessage(script)
    console.log(message)


    let vars = getFirstRound(script)
    const firstRound = getFirstRoundValues(script, vars)
    for(let i = 0; i < vars.length; i++){
        let elem = vars[i]
        for(let key of Object.entries(firstRound)){
            if(elem.includes(key[0])){
                vars[i] = elem.replace(key[0], key[1])
            }
        }
        vars[i] = eval(vars[i])
    }
    encryptionKey.push(vars)


    let mainVars = getMainRounds(script)
    const mainRounds = getMainRoundsValues(script, mainVars)
    for(let i = 0; i < mainVars.length; i++){
        let elem = mainVars[i]
        for(let key of Object.entries(mainRounds)){
            if(elem.includes(key[0])){
                mainVars[i] = elem.replace(key[0], key[1])
            }
        }
        mainVars[i] = eval(mainVars[i])
    }
    for(let i = 0; i < 13; i++){
        encryptionKey.push(mainVars.splice(0, 4))
    }


    let lastVars = getLastRounds(script)
    lastVars = checkLastRounds(script, lastVars)
    const lastRounds = getLastRoundValues(script, lastVars)
    for(let i = 0; i < lastVars.length; i++){
        let elem = lastVars[i]
        for(let key of Object.entries(lastRounds)){
            if(elem.includes(key[0])){
                lastVars[i] = elem.replace(key[0], key[1])
            }
        }
        lastVars[i] = eval(lastVars[i])
    }

    encryptionKey.push(lastVars)
    console.log(encryptionKey)
    console.log(convertKeArrayToKey(encryptionKey))
}

start()