import * as React from 'react';
import {
  DecodedValueMap,
  EncodedQuery,
  encodeQueryParams,
  QueryParamConfigMap,
  EncodedValueMap,
} from 'serialize-query-params';
import {
  getSSRSafeSearchString,
  usePreviousIfShallowEqual,
  useUpdateRefIfShallowNew,
} from './helpers';
import { useLocationContext } from './LocationProvider';
import { sharedMemoizedQueryParser } from './memoizedQueryParser';
import shallowEqual from './shallowEqual';
import { SetQuery, UrlUpdateType } from './types';

type ChangesType<DecodedValueMapType> =
  | Partial<DecodedValueMapType>
  | ((latestValues: DecodedValueMapType) => Partial<DecodedValueMapType>);

/**
 * Given a query parameter configuration (mapping query param name to { encode, decode }),
 * return an object with the decoded values and a setter for updating them.
 */
export const useQueryParams = <QPCMap extends QueryParamConfigMap>(
  paramConfigMap: QPCMap
): [DecodedValueMap<QPCMap>, SetQuery<QPCMap>] => {
  const [getLocation, setLocation] = useLocationContext();

  // read in the raw query
  const parsedQuery = sharedMemoizedQueryParser(
    getSSRSafeSearchString(getLocation())
  );

  // make caches
  const paramConfigMapRef = React.useRef(paramConfigMap);
  const parsedQueryRef = React.useRef(parsedQuery);
  const encodedValuesCacheRef = React.useRef<
    Partial<EncodedValueMap<QPCMap>> | undefined
  >(undefined); // undefined for initial check
  const decodedValuesCacheRef = React.useRef<Partial<DecodedValueMap<QPCMap>>>(
    {}
  );

  // memoize paramConfigMap to make the API nicer for consumers.
  // otherwise we'd have to useQueryParams(useMemo(() => { foo: NumberParam }, []))
  paramConfigMap = usePreviousIfShallowEqual(paramConfigMap);

  function getLatestDecodedValues(): {
    encodedValues: Partial<EncodedValueMap<QPCMap>>;
    decodedValues: Partial<DecodedValueMap<QPCMap>>;
  } {
    // check if we have a new param config
    const hasNewParamConfigMap = !shallowEqual(
      paramConfigMapRef.current,
      paramConfigMap
    );

    // read in the parsed query
    const parsedQuery = sharedMemoizedQueryParser(
      getSSRSafeSearchString(getLocation()) // get the latest location object
    );

    // check if new encoded values are around (new parsed query).
    // can use triple equals since we already cache this value
    const hasNewParsedQuery = parsedQueryRef.current !== parsedQuery;

    // if nothing has changed, use existing.. so long as we have existing.
    if (
      !hasNewParsedQuery &&
      !hasNewParamConfigMap &&
      encodedValuesCacheRef.current !== undefined
    ) {
      return {
        encodedValues: encodedValuesCacheRef.current,
        decodedValues: decodedValuesCacheRef.current,
      };
    }

    const encodedValuesCache: Partial<EncodedValueMap<QPCMap>> =
      encodedValuesCacheRef.current || {};
    const decodedValuesCache: Partial<DecodedValueMap<QPCMap>> =
      decodedValuesCacheRef.current || {};
    const encodedValues: Partial<EncodedValueMap<QPCMap>> = {};

    // we have new encoded values, so let's get new decoded values.
    // recompute new values but only for those that changed
    const paramNames = Object.keys(paramConfigMap);
    const decodedValues: Partial<DecodedValueMap<QPCMap>> = {};
    for (const paramName of paramNames) {
      // do we have a new encoded value?
      const paramConfig = paramConfigMap[paramName];
      const hasNewEncodedValue = !shallowEqual(
        encodedValuesCache[paramName],
        parsedQuery[paramName]
      );

      // if we have a new encoded value, re-decode. otherwise reuse cache
      let encodedValue;
      let decodedValue;
      if (hasNewEncodedValue) {
        encodedValue = parsedQuery[paramName];
        decodedValue = paramConfig.decode(encodedValue);
      } else {
        encodedValue = encodedValuesCache[paramName];
        decodedValue = decodedValuesCache[paramName];
      }

      encodedValues[paramName as keyof QPCMap] = encodedValue;
      decodedValues[paramName as keyof QPCMap] = decodedValue;
    }

    // keep referential equality for decoded valus if we didn't actually change anything
    const hasNewDecodedValues = !shallowEqual(
      decodedValuesCacheRef.current,
      decodedValues
    );

    return {
      encodedValues,
      decodedValues: hasNewDecodedValues
        ? decodedValues
        : decodedValuesCacheRef.current,
    };
  }

  // decode all the values if we have changes
  const { encodedValues, decodedValues } = getLatestDecodedValues();

  // update cached values in useEffects
  useUpdateRefIfShallowNew(parsedQueryRef, parsedQuery);
  useUpdateRefIfShallowNew(paramConfigMapRef, paramConfigMap);
  useUpdateRefIfShallowNew(encodedValuesCacheRef, encodedValues);
  useUpdateRefIfShallowNew(decodedValuesCacheRef, decodedValues);

  // create a setter for updating multiple query params at once
  const setQuery = React.useCallback(
    (
      changes: ChangesType<DecodedValueMap<QPCMap>>,
      updateType?: UrlUpdateType
    ) => {
      let encodedChanges: EncodedQuery;
      if (typeof changes === 'function') {
        // get latest decoded value to pass as a fresh arg to the setter fn
        const { decodedValues: latestValues } = getLatestDecodedValues();
        decodedValuesCacheRef.current = latestValues; // keep cache in sync

        encodedChanges = (changes as Function)(latestValues);
      } else {
        // encode as strings for the URL
        encodedChanges = encodeQueryParams(paramConfigMap, changes);
      }

      // update the URL
      setLocation(encodedChanges, updateType);
    },
    [paramConfigMap, setLocation]
  );

  // no longer Partial
  return [decodedValues as DecodedValueMap<QPCMap>, setQuery];
};

export default useQueryParams;
