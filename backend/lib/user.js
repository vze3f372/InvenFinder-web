'use strict';

const crypto = require('crypto');
const util = require('util');

const Permissions = require('./permissions');
const connectionPromise = require('./db');

const pbkdf2 = util.promisify(crypto.pbkdf2);

const PBKDF2ITERATIONS = 100000;
const DEFAULT_PERMISSIONS = 0;


class User {
	id;
	username;
	#passwordSalt;
	#passwordHash;
	permissions;

	#saveHandle;


	static #makeReactive(user) {
		const proxy = {
			set(target, propertyKey, value, receiver) {
				clearImmediate(target.#saveHandle);

				target.#saveHandle = setImmediate(async () => {
					const connection = await connectionPromise;
					await connection.query(`insert into invenfinder.users(id,
					                                                      username,
					                                                      password_salt,
					                                                      password_hash,
					                                                      permissions)
					                        values (?, ?, ?, ?, ?)
					                        on duplicate key update username = values(username),
					                                                password_salt = values(password_salt),
					                                                password_hash = values(password_hash),
					                                                permissions = values(permissions)`,
						[target.id, target.username, target.#passwordSalt, target.#passwordHash, target.permissions]);
				});

				return Reflect.set(target, propertyKey, value, receiver);
			}
		};

		return new Proxy(user, proxy);
	}


	static #assignUser(user, props) {
		user.id = props.id;
		user.username = props.username;
		user.#passwordSalt = props.password_salt;
		user.#passwordHash = props.password_hash;
		user.permissions = props.permissions;

		clearImmediate(user.#saveHandle);
		return this.#makeReactive(user);
	}


	static async create(options) {
		if (!options.username || !options.password) {
			return null;
		}

		const user = this.#assignUser(this.#makeReactive(new User()), options);
		const salt = crypto.randomBytes(32);
		const hash = await pbkdf2(options.password, salt, PBKDF2ITERATIONS, 64, 'sha3-256');

		user.#passwordSalt = salt.toString('base64');
		user.#passwordHash = hash.toString('base64');
		clearImmediate(user.#saveHandle);

		const connection = await connectionPromise;
		const res = await connection.query(`insert into invenfinder.users(username,
		                                                                  password_salt,
		                                                                  password_hash,
		                                                                  permissions)
		                                    values (?, ?, ?, ?)`,
			[user.username, user.#passwordSalt, user.#passwordHash, user.permissions]);

		user.id = res.insertId;
		clearImmediate(user.#saveHandle);
		return user;
	}


	static async getByID(id) {
		if (!id) {
			return null;
		}

		const connection = await connectionPromise;
		const rows = await connection.query(`select *
		                                     from invenfinder.users
		                                     where id=?`, [id]);

		if (!rows.length) {
			return null;
		} else {
			return this.#assignUser(new User(), rows[0]);
		}
	}


	static async getByUsername(username) {
		if (!username) {
			return null;
		}

		const connection = await connectionPromise;
		const rows = await connection.query(`select *
		                                     from invenfinder.users
		                                     where username=?`, [username]);

		if (!rows.length) {
			return null;
		}

		return this.#assignUser(new User(), rows[0]);
	}


	static async getAll() {
		const users = [];

		const connection = await connectionPromise;
		const rows = await connection.query(`select *
		                                     from invenfinder.users`);

		for (const row of rows) {
			users.push(this.#assignUser(new User(), row));
		}

		return users;
	}


	async verifyPassword(password) {
		if (!password) {
			return false;
		}

		const salt = Buffer.from(this.#passwordSalt, 'base64');
		const hash = Buffer.from(this.#passwordHash, 'base64');

		return hash.equals(await pbkdf2(password, salt, PBKDF2ITERATIONS, 64, 'sha3-256'));
	}


	async setPassword(password) {
		if (!password) {
			return this;
		}

		const salt = crypto.randomBytes(32);
		const hash = await pbkdf2(password, salt, PBKDF2ITERATIONS, 64, 'sha3-256');

		this.#passwordSalt = salt.toString('base64');
		this.#passwordHash = hash.toString('base64');

		return this;
	}


	hasPermissions(permissions) {
		const permissionValue = Permissions.getPermissionValue(permissions);

		// noinspection JSBitwiseOperatorUsage
		return ((this.permissions & permissionValue) === permissionValue);
	}


	async delete() {
		const connection = await connectionPromise;
		await connection.query(`delete
		                        from invenfinder.users
		                        where id=?`, [this.id]);
	}
}


module.exports = User;
