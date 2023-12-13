import adaptRequest from "./adapt-request.js";
import log from "#utils/log.js";

/**
 * @param {Controller} controller
 * @returns {*} callback
 */
export default function makeExpressCallback(controller) {

    return async function (/** @type ExpressRequest */ req, /** @type ExpressResponse */ res) {
        const httpRequest = adaptRequest(req);
        try {
            const vldResult = controller.validateRequest(httpRequest);

            const httpResponse = vldResult.isValid
                ? (await controller.handleRequest(httpRequest))
                : vldResult.httpErrorResponse;

            if (httpResponse.headers) {
                res.set(httpResponse.headers);
            }

            if (httpResponse.cookies) {
                // Do NOT use `for ... in` for Arrays. See https://stackoverflow.com/a/500531.
                httpResponse.cookies.forEach(( /** @type {SetCookie} */ cookie) => {
                    res.cookie(cookie.name, cookie.value, cookie.options);
                });
            }

            /** @todo TODO if size of response is large, it probably means we have a security leak, mainly SQL injection.
             *  So return 500 instead.
            */

            res.status(httpResponse.statusCode).send(httpResponse.payload);
        }
        catch (e) {
            log({
                level: "http",
                keyword: "Response:5xx",
                message: "500 from server."
            });
            res.status(500).json({ error: "An unknown error occurred on the server." });
        }
    };
}

/**
 * @typedef {import("#types").ExpressRequest} ExpressRequest
 * @typedef {import("#types").ExpressResponse} ExpressResponse
 * @typedef {import("../types").HttpRequest} HttpRequest
 * @typedef {import("#types").Controller} Controller
 * @typedef {import("#types").SetCookie} SetCookie
*/
