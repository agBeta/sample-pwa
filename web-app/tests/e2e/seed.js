// These seed are used for e2e tests.
import path from "node:path";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { faker } from "@faker-js/faker/locale/fa";
import makeDbConnectionPool from "#da/connection.js";

dotenv.config({
    path: path.resolve(new URL(".", import.meta.url).pathname, /*-->*/ "e2e.env"),
    override: true,
});
const dbConnectionPool = makeDbConnectionPool({ port: 3306 });

faker.seed(100);
await clearAll();
const userIds = await seedUsers(10);
await seedBlogs(userIds, 50);
dbConnectionPool.end();

async function clearAll(){
    const db = await dbConnectionPool;
    await db.execute("DELETE FROM user_tbl;");
}

async function seedUsers(n = 10) {
    //  For transactions take a look at:
    //  https://stackoverflow.com/a/38717014
    //  https://stackoverflow.com/a/70240338
    //  https://github.com/sidorares/node-mysql2/issues/384#issuecomment-543727621

    // We cannot use the pool directly to begin a transaction like you can be for a query. See first link above.
    const cn = await dbConnectionPool.getConnection();
    await cn.beginTransaction();
    const ids = [];

    for (let i = 0; i < n; i++) {
        //  We cannot use makeFakeUser from fixtures, since that function create a user from POV of client,
        //  unlike here that we are adding directly to database.

        const user = {
            id: randomBytes(12).toString("hex"), // 24 characters
            // well-formed predictable email and password so that automated e2e tests can login.
            email: `email_of_${i}@mail.com`,
            password: `pass_user_${i}`,
            displayName: faker.person.fullName(),
            birthYear: faker.number.int({ min: 1330, max: 1395 }),
            signupAt: faker.date.between({
                from: "2018-01-01T00:00:00.000Z",
                to: "2023-12-20T00:00:00.000Z"
            }),
        };
        ids.push(user.id);

        // NOTE, you must the same hash function that is used inside auth-signup controller.
        const h = await bcrypt.hash(user.password, 9);

        await cn.query(`
            INSERT INTO user_tbl
                (id, email, hashed_password, display_name, birth_year, signup_at)
                VALUES (?, ?, ?, ?, ?, ?)
        `, [user.id, user.email, h, user.displayName, user.birthYear, user.signupAt]);
    }

    await cn.commit();
    return ids;
}

/** @param {string[]} usersId */
async function seedBlogs(usersId, n = 50) {
    const cn = await dbConnectionPool.getConnection();
    await cn.beginTransaction();

    // The blogs must be added chronologically, i.e. in ASC (actually "not DESC" to be precise) order of [createdAt].
    let /**@type {Date}*/ previousBlogCreatedAt;

    let sqlCmd = `
        INSERT INTO blog_tbl
            (   id,           author_id,   blog_title,
                blog_body,    blog_topic,  image_url,
                is_published, created_at,  modified_at
            )
            VALUES
    `;
    const params = [];

    for (let i = 0; i < n; i++) {
        const blog = {
            id: randomBytes(12).toString("hex"),
            authorId: randomAuthorId(),
            blogTitle: faker.lorem.words({ min: 2, max: 5 }),
            blogBody: faker.lorem.lines({ min: 10, max: 20 }),
            blogTopic: "Technology",
            imageUrl: null,
            isPublished: true,
            createdAt: i == 0 ? new Date("2020-01-01T00:00:00.000Z") : faker.date.between({
                // @ts-ignore
                from: previousBlogCreatedAt,
                // @ts-ignore
                to: new Date(previousBlogCreatedAt.getTime() + /*20 days*/1000 * 60 * 60 * 24 * 20),
            }),
            modifiedAt: new Date(),
        };
        previousBlogCreatedAt = blog.createdAt;
        // @ts-ignore
        blog.modifiedAt = new Date(blog.createdAt);

        if (i > 0) sqlCmd += "\n ,";
        sqlCmd += `
            (   '${blog.id}',        '${blog.authorId}',   '${blog.blogTitle}',
                '${blog.blogBody}',   '${blog.blogTopic}',  '${blog.imageUrl}',
                TRUE,
                '${convertToMySQLDatetime(blog.createdAt)}',
                '${convertToMySQLDatetime(blog.modifiedAt)}'
            )
        `;
    }

    sqlCmd += ";";
    await cn.query(sqlCmd, []);
    await cn.commit();

    function randomAuthorId() {
        return userIds[Math.floor(Math.random() * userIds.length)];
    }
    function convertToMySQLDatetime(/**@type {Date}*/d) {
        //  Based on "Paulo Roberto Rosa" comment in https://stackoverflow.com/questions/5129624/convert-js-date-time-to-mysql-datetime
        //  This seems to also account timezone.
        return d.toISOString().split("T")[0]+" "+d.toTimeString().split(" ")[0];
    }
}