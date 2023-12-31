import Joi from "joi";
import makeBasicValidateNormalize from "../validate-normalize.js";
import CONSTANTS from "../constants.js";
import makeHttpError from "../http-error.js";

/**
 * @param {*} param0
 * @returns {Controller}
 */
export function makeEndpointController({
    find_action_record_by_actionId,
    update_action,
    generateCollisionResistentId,
    sanitizeText,
    insert_blog,
}) {

    // @ts-ignore
    return Object.freeze({
        handleRequest,
        validateRequest: makeBasicValidateNormalize({
            schemaOfBody: Joi.object({
                blogTitle: Joi.string().min(3).max(255).required(),
                blogBody: Joi.string().min(10).max(5000).required(),
                blogTopic: Joi.string().min(2).max(63).required(),
                imageUrl: Joi.string().min(10).max(200) /*optional*/,
            }),
            schemaOfPathParams: Joi.object({
                // Regex from https://stackoverflow.com/a/3028646.
                actionId: Joi.string().min(10).max(50).required().pattern(new RegExp("^[a-zA-Z0-9_]*$"))
            }),
        }),
    });


    /** @returns {Promise<HttpResponse>} */
    async function handleRequest(/**@type {AuthenticatedHttpRequest}*/ httpRequest) {
        const userId = httpRequest.userId;
        const actionId = httpRequest.pathParams.actionId;
        const action = await find_action_record_by_actionId({ actionId });

        if (!action) {
            return makeHttpError({
                statusCode: 404,
                error: "Not found."
            });
        }
        if (action.userId !== userId) {
            return makeHttpError({
                // Although 403 is semantically the correct choice, but don't. 403 leaks info.
                statusCode: 404,
                error: "Not found."
            });
        }
        // No need to check if (action.purpose === "blog:post"). Very rare edge case.

        if (action.state === CONSTANTS.actionState.FINISHED) {
            //  Return the same response without doing nothing else.
            return JSON.parse(action.response);
        }

        if (action.state === CONSTANTS.actionState.PROCESSING) {
            return {
                // it is a pity we can't use marvelous 420 here.
                statusCode: 429,
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-store",
                },
                payload: JSON.stringify({ error: "Your request has already been received." })
            };
        }

        await update_action({
            id: action.id,
            state: CONSTANTS.actionState.PROCESSING,
        });

        const blogId = generateCollisionResistentId();

        // @ts-ignore
        const /**@type {string}*/ blogTitle = sanitizeText(httpRequest.body.blogTitle).trim();
        // @ts-ignore
        const /**@type {string}*/ blogBody = sanitizeText(httpRequest.body.blogBody).trim();
        // @ts-ignore
        const /**@type {string}*/ blogTopic = sanitizeText(httpRequest.body.blogTopic).trim();
        // @ts-ignore
        const /**@type {string}*/ imageUrl = httpRequest.body.imageUrl;

        // We assume the user has permission to include image in his blog.
        const isPermittedToHaveImage = true;
        if (!isPermittedToHaveImage) {
            return makeHttpError({
                statusCode: 403,
                error: "You aren't allowed to insert image into your blog."
            });
        }

        // In future versions we may ask an AI to moderate and review content of the blog. But for now...
        const isPublished = true;
        //  In high traffic, server may experience spikes that cause two consecutive Date.now() statements show
        //  different values. To prevent this ↙️
        const now = Date.now();


        await insert_blog({
            id: blogId,
            authorId: userId,
            blogTitle,
            blogBody,
            blogTopic,
            imageUrl,
            isPublished,
            createdAt: now,
            modifiedAt: now,
        });

        const /**@type {HttpResponse}*/ response = {
            statusCode: 201,
            headers: {
                "Location": `/blog/${blogId}`,
                "Content-Type": "application/json",
                "Cache-Control": "max-age=3600",
            },
            payload: JSON.stringify({ success: true, blogId }),
        };

        //  There is a tiny possibility that MySQL event scheduler deletes the action within the time we updated
        //  the action to PROCESSING till now (i.e. when action expiresAt is very close to current time). So we
        //  shouldn't let update_action below throws an error to upstream (which would result in incorrect 5xx
        //  response to the client, although the entity is actually created and inserted to db).
        //  Another bad scenario happens when update_action throws some error (like connection is closed, etc.).
        //  Again we shouldn't bubble the error to upstream (to prevent from sending 5xx to client).

        //  On the other hand if any error happens during update_action below, it will leave our application in
        //  an invalid state, meaning action is actually FINISHED but db shows it is still in PROCESSING state. If
        //  the client retries the action it will get an incorrect response from server.
        //  there is NO way to automatically recover from this scenario, unless we retry update_action over and over
        //  again.

        //  Eventually we made up our mind to do this:
        await update_action({
            id: action.id,
            state: CONSTANTS.actionState.FINISHED,
            response: JSON.stringify(response),
        });
        // For simplicity we ignored all these rare scenarios.
        /**@todo TODO alert + throttle (throttle as util with tests) */

        return response;
    }
}


/**
 * @typedef {import("#types").AuthenticatedHttpRequest} AuthenticatedHttpRequest
 * @typedef {import("#types").HttpResponse} HttpResponse
 * @typedef {import("#types").Controller} Controller
 */
