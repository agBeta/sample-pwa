import crypto from "node:crypto";
import { init, isCuid } from "@paralleldrive/cuid2";
import sanitizeHtml from "sanitize-html";
import buildMakeUser from "./user.js";
import buildMakePost from "./post.js";

const Id = Object.freeze({
    createId: init({
        length: 24,
        // less collision between different hosts  https://github.com/paralleldrive/cuid2#configuration.
        fingerprint: (process.env.APP_ID || "host"),
    }),
    isValidId: isCuid
});

const makeUser = buildMakeUser({ Id });

const makePost = buildMakePost({
    Id,
    sanitize: function(text) {
        return sanitizeHtml(text, {
            disallowedTagsMode: "discard",
            allowedIframeHostnames: []
        });
    },
    calcHash: function(text) {
        return crypto.createHash("md5").update(text).digest("hex");
    }
});


export { makeUser, makePost };

