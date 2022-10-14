const core = require('@actions/core');
const aws = require("@aws-sdk/client-ecr");

async function run() {
  try {
    const region = core.getInput('aws-region', { required: false })
    const ecrArgs = {}
    if (region) {
      ecrArgs['region'] = region
    }
    const ecr = new aws.ECR(ecrArgs)

    const registryId = core.getInput('aws-account-id', { required: false })
    const repositoryName = core.getInput('repository', { required: true })
    const imageTag = core.getInput('tag', { required: true })
    const newTags = core.getInput('new-tags', { required: true }).replace(/\s+/g, '').split(',')
    const waitForTagSecondsStr = core.getInput('wait-for-tag-seconds', { required: false });
    const waitForTagRetryIntervalStr = core.getInput('wait-for-tag-retry-interval', { required: false });

    let waitForTagSeconds = 0; 
    let waitForTagRetryInterval = 1; parseInt(waitForTagRetryIntervalStr);
    let retries = 1;

    var isNumeric = function(num) {
      return (typeof(num) === 'number' || typeof(num) === "string" && num.trim() !== '') && !isNaN(num);  
    }

    // if a numeric value was passed, we use it.. but only if it is a positive number
    if (isNumeric(waitForTagSeconds) && parseInt(waitForTagSecondsStr) > 0) {
      waitForTagSeconds = parseInt(waitForTagSecondsStr);
    }

    // if retry is enabled, lets make sure the interval is within a valid range as well
    if (waitForTagSeconds > 0 && isNumeric(waitForTagRetryIntervalStr) && parseInt(waitForTagRetryIntervalStr) > 0) {
      waitForTagRetryInterval = parseInt(waitForTagRetryIntervalStr);

      retries = waitForTagSeconds / waitForTagRetryInterval;

      // make sure we are configured or at least one attempt
      if (retries < 1) {
        retries = 1;
      }
    }

    const getImageParams = { repositoryName, imageIds: [{ imageTag }] }
    if (registryId) {
      getImageParams['registryId'] = registryId
    }

    let putImageCallback = function (err, result) {
      if (err) {
        if (err instanceof aws.ImageAlreadyExistsException) {
          core.info(`${err.message}, no action`)
          return
        }

        core.setFailed(err.message)
      }

      let image = result.image
      core.info(`Image tagged: ${image.repositoryName}:${image.imageId.imageTag}`)
      core.debug(result)
    }

    let current_retry = 1;

    let findExistingImage = function() {
      if (retries > 1) {
          console.log(`Find existing image named '${imageTag}', attempt ${current_retry} of ${retries}...`);
      }
  
      ecr.batchGetImage(getImageParams, getImageCallback);
    }

    let getImageCallback = async function (err, result) {
      if (err && retries > 1 && current_retry < retries) {
        current_retry++;

        if (current_retry < retries) {
          await new Promise(r => setTimeout(r, waitForTagRetryInterval * 1000));
        }

        findExistingImage();
      } else {
        if (err) {
          core.setFailed(err.message)
        }

        if (result.failures.length > 0) {
          const failure = result.failures[0]
          core.setFailed(`${failure.failureCode}: ${failure.failureReason} for tag ${failure.imageId.imageTag}`)
        }

        let image = result.images[0]
        core.info(`Image found: ${image.repositoryName}:${image.imageId.imageTag}`)
        core.debug(image)
        newTags.forEach(function (tag) {
          ecr.putImage(
            {
              registryId: image.registryId,
              repositoryName: image.repositoryName, /* required */
              imageManifest: image.imageManifest, /* required */
              imageTag: tag,
            },
            putImageCallback
          )
        })
      }
    }

    findExistingImage();
  } catch (e) {
    core.setFailed(e instanceof Error ? e.message : JSON.stringify(e))
  }
}

module.exports = run;

/* istanbul ignore next */
if (require.main === module) {
  run();
}
