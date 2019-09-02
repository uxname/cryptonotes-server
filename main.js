const {GraphQLServer} = require("graphql-yoga");
const Datastore = require("nedb");
const cuid = require("cuid");
const AES = require("crypto-js/aes");
const CryptoJS = require("crypto-js");
const express = require('express');

const config = {
    password: 'aengivif0fei9wo0n09shee5oweorohchahnei7Keogeish6io2iu2ahd2Ohx1cawi0xuleebi4Theihoh8kah5shu0xich2koo1',
    hash_salt: 'eih1ahbialae8gohveem9zahx8lughoa0sei9chiegue1Boh8ooleegei1aer7bi6joo1VeaxqNah5peiK9Cah8Taekoghuaquoh',
    port: 4000
};

const db = new Datastore({
    filename: "./database.jsondb",
    autoload: true
});

function encryptString(str) {
    return AES.encrypt(str, config.password).toString();
}

function decryptString(str) {
    return AES.decrypt(str, config.password).toString(CryptoJS.enc.Utf8);
}

db.ensureIndex({fieldName: "key", unique: true}, function (err) {
    if (!err) {
        console.log("Index created: key");
    } else {
        console.log("Index create error: key");
    }
});

const typeDefs = `
  type Query {
    note(key: String!, password_hash: String!): Note
    note_exist(key: String!): Boolean
  }

  type Mutation {
    delete_note(key: String, password_hash: String!): Boolean
    update_note(key: String, password_hash: String!, text: String): Note!
  }

  type Note {
    key: String!,
    text: String
  }
`;

function isNoteExists(key) {
    return new Promise((resolve, reject) => {
        db.count({key: key}, function (err, count) {
            resolve(count === 1);
        });
    })
}

const resolvers = {
    Query: {
        note: (root, {key, password_hash}, ctx, info) =>
            new Promise((resolve, reject) => {
                db.find({key: key, password_hash: password_hash}, function (
                    err,
                    docs
                ) {
                    if (docs.length === 0) {
                        return reject("Not found or wrong password");
                    }

                    const result = {
                        key: docs[0].key,
                        text: decryptString(docs[0].text)
                    };
                    resolve(result);
                });
            }),
        note_exist: (root, {key}, ctx, info) => isNoteExists(key)
    },
    Mutation: {
        update_note: async (root, {key, password_hash, text}, ctx, info) => {
            const isExists = await isNoteExists(key);
            if (isExists) {
                return new Promise((resolve, reject) => {
                    db.find({key: key}, async (err, docs) => {
                        if (err || docs.length === 0) {
                            return reject("Note not found");
                        } else {
                            if (docs[0].password_hash !== password_hash) {
                                return reject("Wrong password");
                            }

                            db.update(
                                {key: key},
                                {$set: {text: encryptString(text)}},
                                {},
                                async (err, numReplaced) => {
                                    if (err || numReplaced === 0) {
                                        return reject("Update note error");
                                    } else {
                                        return resolve({
                                            key: key,
                                            password_hash: password_hash,
                                            text: text
                                        });
                                    }
                                }
                            );
                        }
                    });
                })
            } else {
                return new Promise((resolve, reject) => {
                    let noteKey;
                    if (!key) {
                        noteKey = cuid();
                    } else {
                        noteKey = key;
                    }
                    db.insert(
                        {
                            key: noteKey,
                            password_hash: password_hash,
                            text: encryptString(text)
                        },
                        function (err, newDoc) {
                            if (!err) {
                                resolve({
                                    key: noteKey,
                                    password_hash: password_hash,
                                    text: text
                                });
                            } else {
                                throw new Error(err);
                            }
                        }
                    );
                })
            }
        },
        delete_note: (root, {key, password_hash}, ctx, info) =>
            new Promise((resolve, reject) => {
                db.remove({key: key, password_hash: password_hash}, {}, function (
                    err,
                    numRemoved
                ) {
                    if (numRemoved === 1) {
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                });
            })
    }
};

const server = new GraphQLServer({
    typeDefs: typeDefs,
    resolvers: resolvers,
    mocks: false
});

server.express.use('/', express.static('webapp'));

server.start(
    {
        endpoint: "/graphql",
        tracing: true,
        port: config.port
    },
    () => console.log(`Server is running on http://localhost:${config.port}`)
);


// добавить
// TTL
// заметок
