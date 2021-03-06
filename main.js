const {GraphQLServer} = require("graphql-yoga");
const Datastore = require("nedb");
const cuid = require("cuid");
const AES = require("crypto-js/aes");
const CryptoJS = require("crypto-js");
const express = require('express');

const config = require('./config');

const db = new Datastore({
    filename: "./database.jsondb",
    autoload: true,
    timestampData: true
});

function encryptString(str) {
    return AES.encrypt(str, config.password).toString();
}

function decryptString(str) {
    return AES.decrypt(str, config.password).toString(CryptoJS.enc.Utf8);
}

db.ensureIndex({fieldName: "key", unique: true}, function (err) {
    err ? console.log("Index create error: key") : console.log("Index created: key");
});

function validateKey(key) {
    if (typeof key !== 'string') return false;
    // noinspection RedundantIfStatementJS
    if (/^[a-zA-Z0-9_-]{0,64}$/.test(key) === false) return false;
    return true;
}

function validatePassword(password) {
    const MAX_PASSWORD_SIZE = 256;
    if (typeof password !== 'string') return false;
    if (password.length >= MAX_PASSWORD_SIZE) return false;
    if (/[^ -~]+/.test(password)) return false; //check for invisible characters
    return true;
}

function validateText(text) {
    const MAX_TEXT_SIZE = 512 * 1000;
    if (typeof text !== 'string') return false;
    if (text.length >= MAX_TEXT_SIZE) return false;
    return true;
}

const typeDefs = `
  type Query {
    note(key: String!, password_hash: String!): Note
    note_exist(key: String!): Boolean
  }

  type Mutation {
    delete_note(key: String, password_hash: String!): Boolean
    update_note(
        key: String, 
        password_hash: String!, 
        text: String,
        """Only for creating"""
        ttlInSeconds: Int = -1,
        """Only for creating""" 
        maxOpeningsCount: Int = -1
    ): Note!
  }

  type Note {
    key: String!,
    text: String
  }
`;

function isNoteExists(key) {
    return new Promise((resolve, reject) => {
        db.count({key: key}, (err, count) => {
            resolve(count === 1);
        });
    })
}

function deleteNote(key, password_hash) {
    return new Promise((resolve, reject) => {
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

const resolvers = {
    Query: {
        note: (root, {key, password_hash}, ctx, info) => {
            if (!validateKey(key)) throw new Error('Wrong key format');
            if (!validatePassword(password_hash)) throw new Error('Wrong password format');
            return new Promise((resolve, reject) => {
                db.find({key: key, password_hash: password_hash}, async function (
                    err,
                    docs
                ) {
                    if (docs.length === 0) {
                        return reject("Not found or wrong password 1");
                    }

                    const doc = docs[0];

                    if (doc.ttlInSeconds > 0) {
                        const ttlInMs = doc.ttlInSeconds * 1000;
                        const expireDate = new Date(doc.createdAt.getTime() + ttlInMs);
                        const now = new Date();
                        if (now.getTime() > expireDate.getTime()) {
                            await deleteNote(key, password_hash);
                            return reject("Not found or wrong password 2");
                        }
                    }
                    if (doc.maxOpeningsCount > -1 && doc.openingsCount >= doc.maxOpeningsCount) {
                        await deleteNote(key, password_hash);
                        return reject("Not found or wrong password 3");
                    } else {
                        db.update(
                            {_id: doc._id},
                            {$set: {openingsCount: doc.openingsCount + 1}},
                            {
                                returnUpdatedDocs: true
                            },
                            (err,
                             numAffected,
                             affectedDocument,
                             upsert) => {
                                const result = {
                                    key: affectedDocument.key,
                                    text: decryptString(affectedDocument.text),
                                    openingsCount: affectedDocument.openingsCount
                                };

                                resolve(result);
                            });
                    }
                });
            })
        },
        note_exist: (root, {key}, ctx, info) => {
            if (!validateKey(key)) throw new Error('Wrong key format');
            return isNoteExists(key)
        }
    },
    Mutation: {
        update_note: async (root, {key, password_hash, text, ttlInSeconds, maxOpeningsCount}, ctx, info) => {
            if (!validateKey(key)) throw new Error('Wrong key format');
            if (!validatePassword(password_hash)) throw new Error('Wrong password format');
            if (!validateText(text)) throw new Error('Wrong text format');

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
                            text: encryptString(text),
                            ttlInSeconds: ttlInSeconds,
                            maxOpeningsCount: maxOpeningsCount,
                            openingsCount: 0
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
        delete_note: (root, {key, password_hash}, ctx, info) => {
            if (!validateKey(key)) throw new Error('Wrong key format');
            if (!validatePassword(password_hash)) throw new Error('Wrong password format');
            return deleteNote(key, password_hash)
        }
    }
};

const server = new GraphQLServer({
    typeDefs: typeDefs,
    resolvers: resolvers,
    mocks: false
});

server.express.use('/', express.static(config.webapp_folder));

server.start(
    {
        endpoint: "/graphql",
        tracing: true,
        port: config.port
    },
    () => console.log(`Server is running on http://localhost:${config.port}`)
);


// add input validation
