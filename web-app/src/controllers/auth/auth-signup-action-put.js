import Joi from "joi";
import makeHttpError from "./http-error.js";
import makeBasicValidateNormalize from "./validate-normalize.js";
import log from "#utils/log.js";


export function makeEndpointController({
    find_from_codes_by_email,
    remove_codes_by_email,
    insert_user_into_db,
    compareHash,
    createSecureHash,
    generateCollisionResistentId,
}) {


    return Object.freeze({
        handleRequest,

        validateRequest: makeBasicValidateNormalize({
            schemaOfBody: Joi.object({
                email: Joi.string().email({ allowUnicode: true }).max(80).required(),
                displayName: Joi.string().min(2).max(80).alphanum().required(),
                password: Joi.string().min(3).max(30).required(),
                repeatPassword: Joi.ref("password"),
                birthYear: Joi.number().integer().min(1300).max(1402).required(),
                // must have code. we only register users with verified emails
                code: Joi.string().max(10).required(),
            }),
            schemaOfPathParams: Joi.object({
                actionId: Joi.string().min(10).max(50)
            })
        })
    });


    async function handleRequest(/** @type HttpRequest */ httpRequest) {
        // @ts-ignore
        const /** @type {string} */ email = httpRequest.body.email;
        // @ts-ignore
        const /** @type {string} */ code = httpRequest.body.code;
        // @ts-ignore
        const /** @type {string} */ displayName = httpRequest.body.displayName;
        // @ts-ignore
        const /** @type {string} */ password = httpRequest.body.password;
        // @ts-ignore
        const /** @type {number} */ birthYear = httpRequest.body.birthYear;


        const records = await find_from_codes_by_email({ email: email });

        const isCredentialsValid = records.some(async (el) => {
            return await compareHash(code, el.hashedCode);
        });
        // Don't use Promise.any() above as compareHash always resolves.

        if (!isCredentialsValid) {
            return makeHttpError({
                statusCode: 401,
                error: "Invalid credentials. Either code or email is invalid."
            });
        }

        //  Remove all codes related this email.
        //  No need to await.
        remove_codes_by_email({ email: email })
            .catch(() => {
                // Logging the error, though data-access layer musth have already written some logs.
                log({ level: "error", keyword: "remove-code", message: `failed to remove codes for ${email}` });
            });


        //  Don't check beforehand if the email exists in database or not. We may have loads of traffic or even
        //  application running on several servers. There is slim chance of many signup requests with the same email
        //  being processed at the same time.
        //  Although eventually only one of them manages to insert a new record, but all others will throw an error and
        //  respond with 5xx status, but then we miss the chance to return 409 status (which is the correct status)
        //  for those failed requests.
        //    --->  ❌️  existings = await find_from_users_by_email({ email: email });
        //    --->      if (existings.length > 0) { .... }


        const hashedPassword = await createSecureHash(password);
        const id = generateCollisionResistentId();

        try {
            await insert_user_into_db({
                id,
                email,
                hashedPassword,
                displayName,
                birthYear,
                signupAt: Date.now()
            });

            // Now let's make the user logged in automatically.
            
        }
        catch (err) {
            // if email exists
            return {
                headers: {
                    "Location": "/login",
                    "Content-Type": "application/json",
                },
                statusCode: 409,
                payload: JSON.stringify({ success: false, error: "Email is already registered and verified." })
            };
        }

    }
}



/**
 * @typedef {import("#types").HttpRequest} HttpRequest
 * @typedef {import("#types").HttpResponse} HttpResponse
 * @typedef {import("#types").Controller} Controller
 */